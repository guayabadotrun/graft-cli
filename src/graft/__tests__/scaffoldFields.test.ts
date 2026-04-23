import { describe, it, expect } from 'vitest';

import {
  augmentSchemaWithMechanicalFields,
  deriveScaffoldFields,
  extractChannels,
} from '../scaffoldFields.js';
import type { GraftDocument } from '../build.js';
import type { SkillManifestJson } from '../../openclaw/skills.js';

const skillWithEnv = (name: string, primary_env?: string): SkillManifestJson => ({
  name,
  description: `${name} skill`,
  ...(primary_env ? { primary_env } : {}),
});

describe('deriveScaffoldFields', () => {
  it('emits one secret field per skill that declares primary_env', () => {
    const fields = deriveScaffoldFields({
      skillManifests: [
        skillWithEnv('alpha', 'ALPHA_API_KEY'),
        skillWithEnv('beta', 'BETA_TOKEN'),
      ],
      channels: [],
    });

    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatchObject({
      id: 'alpha_api_key',
      type: 'secret',
      required: true,
      binding: 'settings.secrets.ALPHA_API_KEY',
    });
    expect(fields[0].help).toContain('"alpha"');
    expect(fields[1]).toMatchObject({
      id: 'beta_token',
      binding: 'settings.secrets.BETA_TOKEN',
    });
  });

  it('skips skills without primary_env', () => {
    const fields = deriveScaffoldFields({
      skillManifests: [skillWithEnv('quiet')],
      channels: [],
    });
    expect(fields).toEqual([]);
  });

  it('emits one secret field per channel-required env key', () => {
    const fields = deriveScaffoldFields({
      skillManifests: [],
      channels: ['telegram'],
    });

    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      id: 'telegram_bot_token',
      binding: 'settings.secrets.TELEGRAM_BOT_TOKEN',
    });
    expect(fields[0].help).toContain('"telegram"');
  });

  it('ignores unknown channels (forward-compatibility)', () => {
    const fields = deriveScaffoldFields({
      skillManifests: [],
      // Only `telegram` is in CHANNEL_REQUIRED_SECRETS today.
      channels: ['telegram', 'discord'],
    });
    expect(fields).toHaveLength(1);
    expect(fields[0].id).toBe('telegram_bot_token');
  });

  it('deduplicates when a skill and a channel share the same env key', () => {
    // Contrived but defensive: a skill that happens to read TELEGRAM_BOT_TOKEN
    // shouldn't produce a duplicate secret field.
    const fields = deriveScaffoldFields({
      skillManifests: [skillWithEnv('telegram-helper', 'TELEGRAM_BOT_TOKEN')],
      channels: ['telegram'],
    });
    expect(fields).toHaveLength(1);
    expect(fields[0].help).toContain('"telegram-helper"'); // skill wins (declared first)
  });
});

describe('augmentSchemaWithMechanicalFields', () => {
  const baseSchema: GraftDocument = {
    schema_version: 2,
    framework_constraints: ['openclaw'],
    defaults: { channels: ['telegram'] },
    fields: [],
  };

  it('appends derived fields when the schema has none', () => {
    const augmented = augmentSchemaWithMechanicalFields(baseSchema, {
      skillManifests: [skillWithEnv('alpha', 'ALPHA_API_KEY')],
      channels: ['telegram'],
    });
    expect(augmented.fields).toHaveLength(2);
    expect(augmented.fields.map((f) => f.id)).toEqual([
      'alpha_api_key',
      'telegram_bot_token',
    ]);
  });

  it('preserves author-declared fields and skips collisions on id', () => {
    const authorField = {
      id: 'telegram_bot_token',
      type: 'secret',
      label: 'My custom label',
      required: true,
    };
    const augmented = augmentSchemaWithMechanicalFields(
      { ...baseSchema, fields: [authorField] },
      { skillManifests: [], channels: ['telegram'] },
    );
    expect(augmented.fields).toHaveLength(1);
    expect(augmented.fields[0]).toBe(authorField);
  });

  it('returns a new object — does not mutate the input schema', () => {
    const input: GraftDocument = {
      schema_version: 2,
      framework_constraints: ['openclaw'],
      defaults: { channels: ['telegram'] },
      fields: [],
    };
    const augmented = augmentSchemaWithMechanicalFields(input, {
      skillManifests: [],
      channels: ['telegram'],
    });
    expect(augmented).not.toBe(input);
    expect(input.fields).toEqual([]); // unchanged
    expect(augmented.fields).toHaveLength(1);
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
