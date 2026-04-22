// Pure orchestration of markdown → universal-field decisions.
//
// We only consider three of the seven known markdown files because
// they're the only ones that map cleanly onto universal-language
// fields exposed by the GRAFT schema (gene-seed §2.1.2):
//
//   soul.md     → bio                  (array of strings)
//   memory.md   → knowledge            (array of strings)
//   identity.md → extra_instructions   (single string)
//
// AGENTS.md / USER.md / TOOLS.md / HEARTBEAT.md describe runtime state
// or system-level prompts that should not leak into a marketplace
// template. They are deliberately ignored here.
//
// Acceptance turns the raw markdown into the right shape:
//   - bio / knowledge: split on newlines, trim, drop blank lines
//   - extra_instructions: trimmed verbatim string (newlines preserved)

import type { OpenclawAgentSummary } from '../openclaw/extract.js';
import type { MarkdownKey } from '../openclaw/workspace.js';
import type { MarkdownTarget, Prompter } from './types.js';

export interface MarkdownDecisions {
  bio?: string[];
  knowledge?: string[];
  extra_instructions?: string;
}

/** Ordered list of (file, target) pairs the user is asked about. */
const MAPPINGS: ReadonlyArray<{ file: MarkdownKey; target: MarkdownTarget }> = [
  { file: 'soul', target: 'bio' },
  { file: 'memory', target: 'knowledge' },
  { file: 'identity', target: 'extra_instructions' },
];

/** Result of a `collectMarkdownDecisions` run. */
export interface CollectResult {
  decisions: MarkdownDecisions;
  /** True when the user aborted partway through; caller should stop. */
  cancelled: boolean;
}

export async function collectMarkdownDecisions(
  summary: OpenclawAgentSummary,
  prompter: Prompter,
): Promise<CollectResult> {
  const decisions: MarkdownDecisions = {};

  for (const { file, target } of MAPPINGS) {
    const raw = summary.rawMarkdown[file];
    if (!raw || raw.trim().length === 0) continue;

    const nonBlankLines = raw.split('\n').filter((l: string) => l.trim().length > 0);
    const preview = nonBlankLines.slice(0, 3).join('\n');

    const answer = await prompter.askIncludeMarkdown({
      file,
      target,
      lines: nonBlankLines.length,
      preview,
    });

    if (answer === 'cancel') {
      return { decisions, cancelled: true };
    }
    if (answer === 'skip') continue;

    if (target === 'extra_instructions') {
      decisions.extra_instructions = raw.trim();
    } else {
      // bio + knowledge are arrays of trimmed, non-blank lines.
      decisions[target] = nonBlankLines.map((l: string) => l.trim());
    }
  }

  return { decisions, cancelled: false };
}
