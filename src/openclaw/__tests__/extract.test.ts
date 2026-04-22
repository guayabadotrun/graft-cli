import { describe, it, expect } from 'vitest';
import { extractOpenclawSummary } from '../extract.js';
import type { OpenclawWorkspace } from '../workspace.js';

// Build an OpenclawWorkspace literal in-memory. We don't touch disk
// here — the workspace reader has its own tests; this suite is only
// about the JSON → summary projection.
function makeWorkspace(config: unknown, markdown: Record<string, string> = {}): OpenclawWorkspace {
  return {
    workspacePath: '/tmp/fake',
    configPath: '/tmp/fake/.openclaw/openclaw.json',
    config,
    markdown: markdown as OpenclawWorkspace['markdown'],
  };
}

// Mirrors the shape that openclaw-launcher's generator.ts emits in
// production, trimmed to the fields the extractor cares about.
function realisticConfig(): unknown {
  return {
    agents: {
      defaults: {
        workspace: '/mnt/efs/agents/abc/workspace',
        model: { primary: 'openrouter/anthropic/claude-sonnet-4.6' },
        thinkingDefault: 'medium',
      },
      list: [
        {
          id: 'agent-uuid',
          default: true,
          name: 'Halibut',
          workspace: '/mnt/efs/agents/abc/workspace',
          identity: { name: 'Halibut', emoji: '🐟' },
        },
      ],
    },
    channels: {
      telegram: { botToken: '${TELEGRAM_BOT_TOKEN}', dmPolicy: 'pairing' },
    },
  };
}

describe('extractOpenclawSummary', () => {
  it('extracts identity, model, thinking and channels from a realistic config', () => {
    const summary = extractOpenclawSummary(makeWorkspace(realisticConfig()));

    expect(summary.framework).toBe('openclaw');
    expect(summary.agent).toEqual({ id: 'agent-uuid', name: 'Halibut' });
    expect(summary.universal.model).toBe('anthropic/claude-sonnet-4.6');
    expect(summary.universal.thinking).toBe('medium');
    expect(summary.universal.channels).toEqual(['telegram']);
    expect(summary.universal.skills).toEqual([]);
  });

  it('passes the raw markdown through untouched', () => {
    const md = { soul: '# soul', memory: '# memory' };
    const summary = extractOpenclawSummary(makeWorkspace(realisticConfig(), md));
    expect(summary.rawMarkdown).toBe(md);
  });

  it('keeps the model id as-is when no known provider prefix is present', () => {
    const cfg = realisticConfig() as any;
    cfg.agents.defaults.model.primary = 'anthropic/claude-sonnet-4.6';

    const summary = extractOpenclawSummary(makeWorkspace(cfg));
    expect(summary.universal.model).toBe('anthropic/claude-sonnet-4.6');
  });

  it('omits thinking when the value is not a known level', () => {
    const cfg = realisticConfig() as any;
    cfg.agents.defaults.thinkingDefault = 'turbo';

    const summary = extractOpenclawSummary(makeWorkspace(cfg));
    expect(summary.universal.thinking).toBeUndefined();
  });

  it('returns an empty channel list when no channels block is present', () => {
    const cfg = realisticConfig() as any;
    delete cfg.channels;

    const summary = extractOpenclawSummary(makeWorkspace(cfg));
    expect(summary.universal.channels).toEqual([]);
  });

  it('reads skills defensively from agents.defaults.skills when present', () => {
    const cfg = realisticConfig() as any;
    cfg.agents.defaults.skills = ['github', 'web-search', 42, null];

    const summary = extractOpenclawSummary(makeWorkspace(cfg));
    // Non-string entries are filtered out — we never want to ship a
    // GRAFT with a numeric or null skill slug.
    expect(summary.universal.skills).toEqual(['github', 'web-search']);
  });

  it('returns a minimal summary when the config is essentially empty', () => {
    const summary = extractOpenclawSummary(makeWorkspace({}));
    expect(summary).toEqual({
      framework: 'openclaw',
      agent: {},
      universal: { channels: [], skills: [] },
      rawMarkdown: {},
    });
  });

  it('does not throw when given a config that is not even an object', () => {
    const summary = extractOpenclawSummary(makeWorkspace('not a config'));
    expect(summary.universal.channels).toEqual([]);
    expect(summary.agent).toEqual({});
  });
});
