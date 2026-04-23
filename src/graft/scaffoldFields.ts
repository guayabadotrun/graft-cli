// Mechanical `fields[]` derivation for the "Download GRAFT scaffolding"
// flow (grafts-marketplace.md §3.6.2 — Control A).
//
// The export tool deliberately doesn't try to invent free-text variables
// from prose — that's the author's job, in their editor. But there's a
// well-defined subset of `fields[]` whose binding is purely mechanical
// and which the launcher *can* derive without guessing:
//
//   1. **Skill secrets.** Every installed skill that declares a
//      `primary_env` in its SKILL.md frontmatter needs that env var to
//      be supplied by whoever applies the GRAFT. We emit a `secret`-type
//      field bound to `settings.secrets.<KEY>`, one per skill.
//
//   2. **Channel secrets.** Each channel in `defaults.channels[]` has a
//      known set of required tokens (Telegram → `TELEGRAM_BOT_TOKEN`).
//      Same `secret` shape, same `settings.secrets.<KEY>` binding.
//
// In both cases the derivation is idempotent: if the caller already
// declared a field with the same `id`, we keep theirs and skip the
// derived one. That makes re-bundling an already-edited schema safe.

import type { GraftDocument, GraftField } from './build.js';
import type { SkillManifestJson } from '../openclaw/skills.js';

/**
 * Mapping from channel slug → list of secret env keys that channel needs
 * at runtime. Mirrors the launcher's per-channel wiring in
 * `openclaw-launcher/src/openclaw/generator.ts`.
 *
 * Adding a channel to `ALLOWED_GRAFT_CHANNELS` (build.ts) MUST be paired
 * with an entry here so the scaffold generator knows what to ask for.
 */
const CHANNEL_REQUIRED_SECRETS: Readonly<Record<string, readonly string[]>> = {
  telegram: ['TELEGRAM_BOT_TOKEN'],
};

export interface ScaffoldFieldInputs {
  skillManifests: ReadonlyArray<SkillManifestJson>;
  channels: ReadonlyArray<string>;
}

/**
 * Convert an env-var key (e.g. `TELEGRAM_BOT_TOKEN`) into the lowercase
 * snake_case `id` used in the GRAFT schema (e.g. `telegram_bot_token`).
 * Mirrors the convention used in the seeded GRAFTs.
 */
function envKeyToFieldId(key: string): string {
  return key.toLowerCase();
}

function humanizeKey(key: string): string {
  return key
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Build a single `secret`-type field bound to `settings.secrets.<KEY>`.
 * `provenance` shapes the `help` text so the author can tell at a glance
 * which derivation produced the field.
 */
function buildSecretField(
  envKey: string,
  provenance: { kind: 'skill' | 'channel'; name: string },
): GraftField {
  const help =
    provenance.kind === 'skill'
      ? `Required by the "${provenance.name}" skill (its primary_env).`
      : `Required to run the "${provenance.name}" channel.`;
  return {
    id: envKeyToFieldId(envKey),
    label: humanizeKey(envKey),
    type: 'secret',
    required: true,
    binding: `settings.secrets.${envKey}`,
    help,
  };
}

/**
 * Derive the mechanical `fields[]` entries for a scaffold from the
 * installed skills' manifests and the channels declared in the schema.
 *
 * Pure: no IO, no defaults beyond `id` deduplication. Exported so it can
 * be unit-tested in isolation from the bundle pipeline.
 */
export function deriveScaffoldFields(inputs: ScaffoldFieldInputs): GraftField[] {
  const out: GraftField[] = [];
  const seenIds = new Set<string>();

  // Skill secrets first — they're the most likely to need explicit
  // attention from the author (different skills, different keys).
  for (const manifest of inputs.skillManifests) {
    if (!manifest.primary_env || manifest.primary_env.length === 0) continue;
    const id = envKeyToFieldId(manifest.primary_env);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    out.push(buildSecretField(manifest.primary_env, { kind: 'skill', name: manifest.name }));
  }

  // Channel secrets next.
  for (const channel of inputs.channels) {
    const requiredKeys = CHANNEL_REQUIRED_SECRETS[channel];
    if (!requiredKeys) continue;
    for (const envKey of requiredKeys) {
      const id = envKeyToFieldId(envKey);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      out.push(buildSecretField(envKey, { kind: 'channel', name: channel }));
    }
  }

  return out;
}

/**
 * Return a shallow-cloned schema whose `fields[]` includes the mechanical
 * derivations from `inputs` AFTER any author-declared fields. Author
 * fields take precedence on `id` collisions — the derivation only adds
 * what's missing.
 */
export function augmentSchemaWithMechanicalFields(
  schema: GraftDocument,
  inputs: ScaffoldFieldInputs,
): GraftDocument {
  const existing = Array.isArray(schema.fields) ? schema.fields : [];
  const existingIds = new Set(
    existing
      .map((f) => (f && typeof f === 'object' && typeof f.id === 'string' ? f.id : null))
      .filter((id): id is string => id !== null),
  );
  const derived = deriveScaffoldFields(inputs).filter(
    (f) => typeof f.id === 'string' && !existingIds.has(f.id),
  );
  return {
    ...schema,
    fields: [...existing, ...derived],
  };
}

/**
 * Pull the channel slug list out of `schema.defaults.channels` if it
 * exists and is an array of strings. Returns `[]` otherwise — never
 * throws. The schema's deep shape is `unknown` to graft-cli, so we
 * defend against the obvious malformed cases.
 */
export function extractChannels(schema: GraftDocument): string[] {
  const channels = schema.defaults?.channels;
  if (!Array.isArray(channels)) return [];
  return channels.filter((c): c is string => typeof c === 'string');
}
