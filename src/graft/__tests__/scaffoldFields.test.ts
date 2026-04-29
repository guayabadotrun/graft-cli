import { describe, it, expect } from 'vitest';

import {
  augmentSchemaWithMechanicalFields,
  extractChannels,
} from '../scaffoldFields.js';
import type { GraftDocument, GraftField } from '../build.js';

const baseSchema: GraftDocument = {
  schema_version: 2,
  framework_constraints: ['openclaw'],
  defaults: { channels: ['telegram'] },
  fields: [],
};

describe('augmentSchemaWithMechanicalFields', () => {
  it('returns a schema with no fields when none are declared', () => {
    const augmented = augmentSchemaWithMechanicalFields(baseSchema);
    expect(augmented.fields).toEqual([]);
  });

  it('preserves author-declared fields verbatim', () => {
    const authorField: GraftField = {
      id: 'free_text',
      type: 'text',
      label: 'Free text',
      required: false,
    };
    const augmented = augmentSchemaWithMechanicalFields({
      ...baseSchema,
      fields: [authorField],
    });
    expect(augmented.fields).toHaveLength(1);
    expect(augmented.fields[0]).toMatchObject({
      id: 'free_text',
      type: 'text',
    });
  });

  it('does NOT auto-attach materialize for GITHUB_TOKEN — gh reads $GITHUB_TOKEN natively', () => {
    // The registry is intentionally empty: every entry is a contract
    // that the binary exists in the launcher image. GITHUB_TOKEN was
    // removed because (a) `gh` is not in the launcher base image and
    // (b) `gh` reads $GITHUB_TOKEN natively, so no materialize is
    // needed. The secret still flows to the agent as an env var via
    // the launcher's settings.secrets.* injection.
    const authorField: GraftField = {
      id: 'github_token',
      type: 'secret',
      label: 'GitHub Token',
      required: true,
      binding: 'settings.secrets.GITHUB_TOKEN',
    };
    const augmented = augmentSchemaWithMechanicalFields({
      ...baseSchema,
      fields: [authorField],
    });
    expect(augmented.fields).toHaveLength(1);
    expect(augmented.fields[0].materialize).toBeUndefined();
  });

  it('does NOT overwrite an author-declared materialize block', () => {
    const customMaterialize = {
      type: 'command' as const,
      run: ['my-custom-tool', 'login'],
      stdin: '{{value}}',
    };
    const authorField: GraftField = {
      id: 'github_token',
      type: 'secret',
      label: 'GitHub Token',
      required: true,
      binding: 'settings.secrets.GITHUB_TOKEN',
      materialize: customMaterialize,
    };
    const augmented = augmentSchemaWithMechanicalFields({
      ...baseSchema,
      fields: [authorField],
    });
    expect(augmented.fields[0].materialize).toBe(customMaterialize);
  });

  it('does NOT attach materialize for unknown env keys', () => {
    const authorField: GraftField = {
      id: 'alpha_api_key',
      type: 'secret',
      label: 'Alpha',
      required: true,
      binding: 'settings.secrets.ALPHA_API_KEY',
    };
    const augmented = augmentSchemaWithMechanicalFields({
      ...baseSchema,
      fields: [authorField],
    });
    expect(augmented.fields[0].materialize).toBeUndefined();
  });

  it('does NOT derive a TELEGRAM_BOT_TOKEN field from the telegram channel (the channel UI owns it)', () => {
    const augmented = augmentSchemaWithMechanicalFields({
      ...baseSchema,
      fields: [],
    });
    expect(augmented.fields).toEqual([]);
  });

  it('returns a new object — does not mutate the input schema', () => {
    const input: GraftDocument = {
      schema_version: 2,
      framework_constraints: ['openclaw'],
      defaults: { channels: ['telegram'] },
      fields: [
        {
          id: 'github_token',
          type: 'secret',
          label: 'GitHub Token',
          required: true,
          binding: 'settings.secrets.GITHUB_TOKEN',
        },
      ],
    };
    const before = JSON.stringify(input);
    const augmented = augmentSchemaWithMechanicalFields(input);
    expect(augmented).not.toBe(input);
    expect(JSON.stringify(input)).toBe(before); // unchanged
    // No auto-materialize for GITHUB_TOKEN; field is preserved as-is.
    expect(augmented.fields[0]).toMatchObject({ id: 'github_token' });
  });
});

describe('extractChannels', () => {
  it('returns the channels list when defaults.channels is a string array', () => {
    const schema: GraftDocument = {
      schema_version: 2,
      framework_constraints: ['openclaw'],
      defaults: { channels: ['telegram'] },
      fields: [],
    };
    expect(extractChannels(schema)).toEqual(['telegram']);
  });

  it('returns [] when defaults.channels is missing', () => {
    const schema: GraftDocument = {
      schema_version: 2,
      framework_constraints: ['openclaw'],
      defaults: {},
      fields: [],
    };
    expect(extractChannels(schema)).toEqual([]);
  });
});
