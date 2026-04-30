import { describe, it, expect } from 'vitest';
import {
  FRAMEWORK_MAPPINGS,
  SUPPORTED_FRAMEWORKS,
  isSupportedFramework,
  mappingFor,
} from '../mapping.js';

describe('framework mapping registry', () => {
  it('lists openclaw as a supported framework', () => {
    expect(SUPPORTED_FRAMEWORKS).toContain('openclaw');
    expect(isSupportedFramework('openclaw')).toBe(true);
  });

  it('rejects unknown frameworks', () => {
    expect(isSupportedFramework('letta')).toBe(false);
    expect(isSupportedFramework('')).toBe(false);
    expect(isSupportedFramework(undefined)).toBe(false);
  });

  it('exposes the openclaw → schema field mapping using wizard-field filenames', () => {
    const m = mappingFor('openclaw');
    const byFile = Object.fromEntries(m.map((e) => [e.filename, e.schemaField]));
    expect(byFile['personality.md']).toBe('personality');
    expect(byFile['vibe.md']).toBe('vibe');
    expect(byFile['extra_instructions.md']).toBe('settings.extra_instructions');
  });

  it('retains the original workspace filename for each openclaw mapping', () => {
    const m = mappingFor('openclaw');
    const byFile = Object.fromEntries(m.map((e) => [e.filename, e.workspaceFilename]));
    expect(byFile['personality.md']).toBe('SOUL.md');
    expect(byFile['vibe.md']).toBe('IDENTITY.md');
    expect(byFile['extra_instructions.md']).toBe('AGENTS.md');
  });

  it('keeps every mapping discoverable from the registry', () => {
    for (const slug of SUPPORTED_FRAMEWORKS) {
      expect(FRAMEWORK_MAPPINGS[slug].length).toBeGreaterThan(0);
    }
  });
});
