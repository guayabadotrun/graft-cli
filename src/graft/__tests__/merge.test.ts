import { describe, expect, it } from 'vitest';
import { mergeDecisionsIntoGraft } from '../merge.js';
import type { GraftDocument } from '../build.js';

function baseDoc(): GraftDocument {
  return {
    schema_version: 2,
    framework_constraints: ['openclaw'],
    defaults: {
      channels: ['telegram'],
      settings: { model: 'anthropic/claude-sonnet-4.6', thinking: 'medium' },
    },
    fields: [],
  };
}

describe('mergeDecisionsIntoGraft', () => {
  it('returns a structurally equal document when there are no decisions', () => {
    const out = mergeDecisionsIntoGraft(baseDoc(), {});
    expect(out).toEqual(baseDoc());
  });

  it('does not mutate the input document', () => {
    const input = baseDoc();
    mergeDecisionsIntoGraft(input, { bio: ['hi'] });
    expect(input.defaults).not.toHaveProperty('bio');
  });

  it('writes bio at the top level of defaults', () => {
    const out = mergeDecisionsIntoGraft(baseDoc(), { bio: ['line a', 'line b'] });
    expect(out.defaults.bio).toEqual(['line a', 'line b']);
  });

  it('writes knowledge at the top level of defaults', () => {
    const out = mergeDecisionsIntoGraft(baseDoc(), { knowledge: ['fact'] });
    expect(out.defaults.knowledge).toEqual(['fact']);
  });

  it('writes extra_instructions inside defaults.settings (snake_case path)', () => {
    const out = mergeDecisionsIntoGraft(baseDoc(), { extra_instructions: 'be nice' });
    expect(out.defaults.settings).toEqual({
      model: 'anthropic/claude-sonnet-4.6',
      thinking: 'medium',
      extra_instructions: 'be nice',
    });
  });

  it('creates settings on the fly when the base document had none', () => {
    const stripped: GraftDocument = {
      schema_version: 2,
      framework_constraints: ['openclaw'],
      defaults: {},
      fields: [],
    };
    const out = mergeDecisionsIntoGraft(stripped, { extra_instructions: 'ok' });
    expect(out.defaults.settings).toEqual({ extra_instructions: 'ok' });
  });

  it('omits empty bio / knowledge arrays', () => {
    const out = mergeDecisionsIntoGraft(baseDoc(), { bio: [], knowledge: [] });
    expect(out.defaults).not.toHaveProperty('bio');
    expect(out.defaults).not.toHaveProperty('knowledge');
  });
});
