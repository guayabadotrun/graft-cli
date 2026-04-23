import { describe, expect, it } from 'vitest';
import { buildGraftFromOpenclaw } from '../build.js';
import type { OpenclawAgentSummary } from '../../openclaw/extract.js';

function summary(overrides: Partial<OpenclawAgentSummary['universal']> = {}): OpenclawAgentSummary {
  return {
    framework: 'openclaw',
    agent: { id: 'agt_1', name: 'Sam' },
    universal: {
      model: 'anthropic/claude-sonnet-4.6',
      thinking: 'medium',
      channels: ['telegram'],
      skills: [],
      ...overrides,
    },
    rawMarkdown: {},
  };
}

describe('buildGraftFromOpenclaw', () => {
  it('emits a schema_version 2 document with the openclaw framework constraint', () => {
    const doc = buildGraftFromOpenclaw(summary());
    expect(doc.schema_version).toBe(2);
    expect(doc.framework_constraints).toEqual(['openclaw']);
  });

  it('puts model and thinking under settings (snake_case path per schema spec)', () => {
    const doc = buildGraftFromOpenclaw(summary());
    expect(doc.defaults.settings).toEqual({
      model: 'anthropic/claude-sonnet-4.6',
      thinking: 'medium',
    });
  });

  it('copies channels into defaults when present', () => {
    const doc = buildGraftFromOpenclaw(summary());
    expect(doc.defaults.channels).toEqual(['telegram']);
  });

  it('omits channels when the agent has none configured', () => {
    const doc = buildGraftFromOpenclaw(summary({ channels: [] }));
    expect(doc.defaults.channels).toBeUndefined();
  });

  it('omits settings entirely when neither model nor thinking are known', () => {
    const doc = buildGraftFromOpenclaw(
      summary({ model: undefined, thinking: undefined }),
    );
    expect(doc.defaults.settings).toBeUndefined();
  });

  it('emits settings with only the known keys (model only)', () => {
    const doc = buildGraftFromOpenclaw(summary({ thinking: undefined }));
    expect(doc.defaults.settings).toEqual({ model: 'anthropic/claude-sonnet-4.6' });
  });

  it('always emits an empty fields array (no custom inputs in the baseline)', () => {
    const doc = buildGraftFromOpenclaw(summary());
    expect(doc.fields).toEqual([]);
  });

  it('does not leak bio/knowledge/extra_instructions from markdown', () => {
    const doc = buildGraftFromOpenclaw({
      ...summary(),
      rawMarkdown: { soul: '# I am the agent\n\nLong evolved bio...' },
    });
    expect(doc.defaults).not.toHaveProperty('bio');
    expect(doc.defaults).not.toHaveProperty('knowledge');
    expect(doc.defaults.settings).not.toHaveProperty('extra_instructions');
  });

  it('does not include a steps key (reserved for hand-authored templates)', () => {
    const doc = buildGraftFromOpenclaw(summary());
    expect(doc).not.toHaveProperty('steps');
  });

  it('produces a clone-safe document — mutating the result does not touch the input', () => {
    const input = summary();
    const doc = buildGraftFromOpenclaw(input);
    doc.defaults.channels?.push('email');
    expect(input.universal.channels).toEqual(['telegram']);
  });

  it('throws when an unsupported channel slips through (e.g. legacy `chat`)', () => {
    expect(() => buildGraftFromOpenclaw(summary({ channels: ['chat', 'telegram'] }))).toThrow(
      /unsupported channel/,
    );
  });

  it('throws on a channel not yet wired in the launcher (e.g. discord)', () => {
    expect(() => buildGraftFromOpenclaw(summary({ channels: ['discord'] }))).toThrow(
      /unsupported channel/,
    );
  });
});
