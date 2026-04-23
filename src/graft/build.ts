// GRAFT document builder — turns a framework-specific summary into a
// `schema_version: 2` document ready to be persisted as `graft.json`.
//
// This is the pure half of the pipeline: no IO, no prompts. The CLI
// (and any programmatic caller) is responsible for collecting the
// summary first and writing the result to disk afterwards.
//
// What we DO emit:
//   - `schema_version: 2` (the only value the backend validator accepts)
//   - `framework_constraints: ['openclaw']` so the marketplace knows
//     which frameworks can apply this template
//   - `defaults` carrying only the keys we could read unambiguously
//     (channels, settings.model, settings.thinking)
//   - `fields: []` — this baseline has no custom user inputs; richer
//     templates will be authored by hand or by later iterations of
//     the prompts layer
//
// What we DO NOT emit:
//   - `bio` / `knowledge` / `extra_instructions` — those live in the
//     agent-evolved markdown and require an explicit user decision
//   - `settings.secrets` / hardware / FKs — never templatable
//   - `steps` — only used by hand-authored advanced templates

import type { OpenclawAgentSummary, ThinkingLevel } from '../openclaw/extract.js';

/**
 * Channels that may appear in `defaults.channels[]` of a v2 GRAFT.
 *
 * Mirrors `GraftSchemaValidator::ALLOWED_GRAFT_CHANNELS` in the backend
 * (convolution-api). `chat` is intentionally excluded — it's the always-on
 * gateway transport, not a channel (see
 * gene-seed/internal/roadmap/grafts-marketplace.md §0.4.1+§0.4.2). Adding a
 * channel here MUST be paired with the launcher learning to wire it AND the
 * matching PHP constant.
 */
export const ALLOWED_GRAFT_CHANNELS = ['telegram'] as const;
export type AllowedGraftChannel = typeof ALLOWED_GRAFT_CHANNELS[number];

/**
 * Minimal structural typing for what we emit. The marketplace spec
 * (gene-seed §2.1) allows arbitrary additional keys inside `defaults`
 * so we keep the shape open.
 */
export interface GraftDocument {
  schema_version: 2;
  framework_constraints: string[];
  defaults: GraftDefaults;
  fields: GraftField[];
}

export interface GraftDefaults {
  bio?: string[];
  knowledge?: string[];
  channels?: string[];
  settings?: {
    model?: string;
    thinking?: ThinkingLevel;
    extra_instructions?: string;
  };
}

// Field shape is intentionally `unknown`-ish: this builder never
// produces any, but the type is exported so future iterations can
// extend the document without re-declaring it.
export type GraftField = Record<string, unknown>;

export function buildGraftFromOpenclaw(summary: OpenclawAgentSummary): GraftDocument {
  const defaults: GraftDefaults = {};

  if (summary.universal.channels.length > 0) {
    const unsupported = summary.universal.channels.filter(
      (c) => !(ALLOWED_GRAFT_CHANNELS as readonly string[]).includes(c),
    );
    if (unsupported.length > 0) {
      throw new Error(
        `GRAFT defaults.channels contains unsupported channel(s): ${unsupported.join(', ')}. ` +
          `Allowed: ${ALLOWED_GRAFT_CHANNELS.join(', ')}. ` +
          `Note: 'chat' is not a channel — it is the always-on transport.`,
      );
    }
    defaults.channels = [...summary.universal.channels];
  }

  const settings: NonNullable<GraftDefaults['settings']> = {};
  if (summary.universal.model !== undefined) {
    settings.model = summary.universal.model;
  }
  if (summary.universal.thinking !== undefined) {
    settings.thinking = summary.universal.thinking;
  }
  if (Object.keys(settings).length > 0) {
    defaults.settings = settings;
  }

  return {
    schema_version: 2,
    framework_constraints: [summary.framework],
    defaults,
    fields: [],
  };
}
