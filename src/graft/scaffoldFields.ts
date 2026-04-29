// Mechanical `fields[]` derivation for the "Download GRAFT scaffolding"
// flow (grafts-marketplace.md §3.6.2 — Control A).
//
// Design intent: secrets and runtime variables are **declared by the
// graft author** in `schema.fields[]`. The CLI does NOT try to invent
// fields by reading skill metadata or by deriving channel tokens — the
// platform already collects channel tokens (e.g. `TELEGRAM_BOT_TOKEN`)
// in the channel's own wizard panel, so deriving them here would cause
// duplicate inputs in the install wizard.
//
// What the CLI still does mechanically, because the binding is
// unambiguous and we own the contract:
//
//   * **Materialize enrichment.** When an author-declared `secret`
//     field's binding env key matches a well-known recipe in
//     `KNOWN_MATERIALIZERS`, we attach the `materialize` block so the
//     launcher can wire the credential at agent boot (see
//     `openclaw-launcher/src/utils/materialize.ts`). Authors can
//     override by declaring `materialize` themselves.
//
// The augmentation is idempotent: re-running it on an already-augmented
// schema is a no-op.

import type { GraftDocument, GraftField } from './build.js';

/**
 * Per-secret "how do I make this credential usable" recipes that the
 * launcher can execute at agent boot (see
 * `openclaw-launcher/src/utils/materialize.ts`). When a secret field's
 * binding matches one of these env keys, we pre-fill the matching
 * `materialize` block so the resulting GRAFT is zero-touch: the user
 * pastes the token in the wizard, the launcher does the rest.
 *
 * Keep this list minimal — every entry here is a contract: the launcher
 * MUST be able to run the recipe in the agent container (i.e. the bin
 * MUST be present). Add a new entry only after you've verified the
 * end-to-end flow with a real skill.
 *
 * Authors can always override or add `materialize` blocks by hand in
 * `schema.json`; this registry only fills in the blank when the field
 * doesn't already have one.
 *
 * Note on GITHUB_TOKEN: deliberately NOT in this list. The `gh` CLI
 * reads `$GITHUB_TOKEN` natively, and the launcher already injects
 * `settings.secrets.*` into the OpenClaw gateway environment. A
 * `gh auth login --with-token` materializer would also fail because
 * the launcher base image is intentionally minimal (no `gh` binary).
 * If a future skill genuinely needs a setup command, add it here AND
 * make sure the binary is either pre-installed in the launcher image
 * or installed by the agent at boot.
 */
const KNOWN_MATERIALIZERS: Readonly<Record<string, GraftField['materialize']>> = {};

/**
 * Inputs for `augmentSchemaWithMechanicalFields`. Currently empty in
 * shape, kept as a struct so future mechanical inputs (extraction
 * targets, framework hints) can be added without churning the call
 * sites.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ScaffoldFieldInputs {}

/**
 * Extract the env-key portion of a `settings.secrets.<KEY>` binding, or
 * `null` if the field's binding doesn't match that shape. Used to look
 * up materialize recipes for author-declared secret fields.
 */
function extractSecretEnvKey(field: GraftField): string | null {
  if (field.type !== 'secret') return null;
  const binding = typeof field.binding === 'string' ? field.binding : '';
  const prefix = 'settings.secrets.';
  if (!binding.startsWith(prefix)) return null;
  const key = binding.slice(prefix.length);
  return key.length > 0 ? key : null;
}

/**
 * Attach a `materialize` block to a field when its binding env key has
 * a known recipe and the author hasn't already declared one. Returns a
 * new field (does not mutate) if enrichment applies, otherwise returns
 * the input unchanged.
 */
function enrichWithMaterialize(field: GraftField): GraftField {
  if (field.materialize !== undefined) return field;
  const envKey = extractSecretEnvKey(field);
  if (envKey === null) return field;
  const recipe = KNOWN_MATERIALIZERS[envKey];
  if (!recipe) return field;
  return { ...field, materialize: recipe };
}

/**
 * Return a shallow-cloned schema whose `fields[]` is the author-declared
 * list with `materialize` blocks attached for any field whose binding
 * env key has a known recipe. Author-declared `materialize` blocks are
 * preserved as-is.
 */
export function augmentSchemaWithMechanicalFields(
  schema: GraftDocument,
  _inputs: ScaffoldFieldInputs = {},
): GraftDocument {
  const existing = Array.isArray(schema.fields) ? schema.fields : [];
  const enriched = existing.map((f) =>
    f && typeof f === 'object' ? enrichWithMaterialize(f) : f,
  );
  return {
    ...schema,
    fields: enriched,
  };
}

/**
 * Pull the channel slug list out of `schema.defaults.channels` if it
 * exists and is an array of strings. Returns `[]` otherwise — never
 * throws. Kept here (rather than removed) because callers still need to
 * inspect declared channels for unrelated bookkeeping; not used by the
 * augmenter itself anymore.
 */
export function extractChannels(schema: GraftDocument): string[] {
  const channels = schema.defaults?.channels;
  if (!Array.isArray(channels)) return [];
  return channels.filter((c): c is string => typeof c === 'string');
}
