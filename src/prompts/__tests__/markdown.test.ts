import { describe, expect, it } from 'vitest';
import { collectMarkdownDecisions } from '../markdown.js';
import type {
  MarkdownDecision,
  MarkdownPromptInput,
  Prompter,
} from '../types.js';
import type { OpenclawAgentSummary } from '../../openclaw/extract.js';
import type { WorkspaceMarkdown } from '../../openclaw/workspace.js';

function makeSummary(markdown: WorkspaceMarkdown): OpenclawAgentSummary {
  return {
    framework: 'openclaw',
    agent: { id: 'agt_1', name: 'Sam' },
    universal: { channels: [], skills: [] },
    rawMarkdown: markdown,
  };
}

interface ScriptedPrompter extends Prompter {
  calls: MarkdownPromptInput[];
}

function scriptedPrompter(answers: Partial<Record<string, MarkdownDecision>>): ScriptedPrompter {
  const calls: MarkdownPromptInput[] = [];
  return {
    calls,
    async askIncludeMarkdown(input) {
      calls.push(input);
      return answers[input.file] ?? 'skip';
    },
    async askMetadata() {
      throw new Error('askMetadata should not be called from collectMarkdownDecisions tests');
    },
  };
}

describe('collectMarkdownDecisions', () => {
  it('skips files that are missing from the workspace', async () => {
    const prompter = scriptedPrompter({});
    const result = await collectMarkdownDecisions(makeSummary({}), prompter);
    expect(prompter.calls).toEqual([]);
    expect(result).toEqual({ decisions: {}, cancelled: false });
  });

  it('skips files whose contents are blank', async () => {
    const prompter = scriptedPrompter({ soul: 'include' });
    const result = await collectMarkdownDecisions(
      makeSummary({ soul: '   \n\n  ' }),
      prompter,
    );
    expect(prompter.calls).toEqual([]);
    expect(result.decisions).toEqual({});
  });

  it('only asks about soul / memory / identity (ignores other agent-evolved files)', async () => {
    const prompter = scriptedPrompter({});
    await collectMarkdownDecisions(
      makeSummary({
        soul: 'a',
        memory: 'b',
        identity: 'c',
        agents: 'AGENTS.md is runtime state',
        user: 'USER.md is user-specific',
        tools: 'TOOLS.md is system prompt',
        heartbeat: 'HEARTBEAT.md is runtime state',
      }),
      prompter,
    );
    expect(prompter.calls.map((c) => c.file)).toEqual(['soul', 'memory', 'identity']);
  });

  it('targets the right universal field for each file', async () => {
    const prompter = scriptedPrompter({});
    await collectMarkdownDecisions(
      makeSummary({ soul: 'a', memory: 'b', identity: 'c' }),
      prompter,
    );
    expect(prompter.calls.map((c) => `${c.file}->${c.target}`)).toEqual([
      'soul->bio',
      'memory->knowledge',
      'identity->extra_instructions',
    ]);
  });

  it('turns SOUL.md into a bio array (one entry per non-blank line, trimmed)', async () => {
    const prompter = scriptedPrompter({ soul: 'include' });
    const result = await collectMarkdownDecisions(
      makeSummary({ soul: '  Line one  \n\n  Line two\n' }),
      prompter,
    );
    expect(result.decisions.bio).toEqual(['Line one', 'Line two']);
  });

  it('turns MEMORY.md into a knowledge array the same way', async () => {
    const prompter = scriptedPrompter({ memory: 'include' });
    const result = await collectMarkdownDecisions(
      makeSummary({ memory: '- fact A\n- fact B\n' }),
      prompter,
    );
    expect(result.decisions.knowledge).toEqual(['- fact A', '- fact B']);
  });

  it('turns IDENTITY.md into a single trimmed extra_instructions string (newlines preserved)', async () => {
    const prompter = scriptedPrompter({ identity: 'include' });
    const result = await collectMarkdownDecisions(
      makeSummary({ identity: '\nLine 1\n\nLine 2\n' }),
      prompter,
    );
    expect(result.decisions.extra_instructions).toBe('Line 1\n\nLine 2');
  });

  it('passes a 3-line preview and the non-blank line count to the prompter', async () => {
    const prompter = scriptedPrompter({});
    await collectMarkdownDecisions(
      makeSummary({ soul: 'a\nb\n\nc\nd\ne' }),
      prompter,
    );
    expect(prompter.calls[0]).toMatchObject({
      file: 'soul',
      lines: 5,
      preview: 'a\nb\nc',
    });
  });

  it('stops the flow when the user cancels and reports cancelled=true', async () => {
    const prompter = scriptedPrompter({ soul: 'include', memory: 'cancel' });
    const result = await collectMarkdownDecisions(
      makeSummary({ soul: 'bio line', memory: 'fact', identity: 'persona' }),
      prompter,
    );
    expect(result.cancelled).toBe(true);
    // soul was already accepted before the cancel
    expect(result.decisions.bio).toEqual(['bio line']);
    // identity is never asked
    expect(prompter.calls.map((c) => c.file)).toEqual(['soul', 'memory']);
  });

  it('does not record a decision when the user picks skip', async () => {
    const prompter = scriptedPrompter({ soul: 'skip' });
    const result = await collectMarkdownDecisions(
      makeSummary({ soul: 'bio line' }),
      prompter,
    );
    expect(result.decisions).toEqual({});
  });
});
