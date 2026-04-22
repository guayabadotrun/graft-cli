// Prompt-layer abstractions.
//
// The CLI is the only place that talks to a real TTY (via @clack/prompts).
// Everything in `src/prompts/markdown.ts` takes a `Prompter` so tests can
// inject deterministic answers without spawning interactive shells.

import type { MarkdownKey } from '../openclaw/workspace.js';
import type { GraftMetadata } from '../graft/package.js';

/** Universal-language target for one of the agent-evolved markdown files. */
export type MarkdownTarget = 'bio' | 'knowledge' | 'extra_instructions';

export interface MarkdownPromptInput {
  /** The markdown file the question is about (e.g. `'soul'`). */
  file: MarkdownKey;
  /** Universal-language field this file would land in if accepted. */
  target: MarkdownTarget;
  /** Number of non-blank lines in the source — handy for the prompt copy. */
  lines: number;
  /** First few lines verbatim, so the user can recognise what they're including. */
  preview: string;
}

export type MarkdownDecision = 'include' | 'skip' | 'cancel';

/**
 * Result of the metadata prompt. Implementations return `null` when
 * the user cancels (Ctrl-C / ESC) so the caller can stop early.
 */
export type MetadataResult = GraftMetadata | null;

export interface Prompter {
  /**
   * Ask the user whether to include a given markdown file as a GRAFT field.
   * Implementations return `'cancel'` when the user aborts the whole flow
   * (e.g. Ctrl-C on a clack prompt) so the caller can stop early.
   */
  askIncludeMarkdown(input: MarkdownPromptInput): Promise<MarkdownDecision>;

  /**
   * Ask the user for the marketplace metadata block. The `defaults`
   * argument is a fully-formed metadata object with sensible suggestions
   * derived from the agent (slug from the name, version 0.1.0, etc.) —
   * implementations should pre-fill each prompt with these values.
   */
  askMetadata(defaults: GraftMetadata): Promise<MetadataResult>;
}

