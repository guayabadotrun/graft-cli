// Harness → GRAFT field mapping registry.
//
// Each supported harness declares which on-disk markdown files carry
// which GRAFT schema field.
//
// `filename`          — the file as it appears in the GRAFT scaffold (the
//                       dev edits this). Named after the wizard field so
//                       the purpose is obvious at a glance.
// `workspaceFilename` — the corresponding file in the agent workspace
//                       (harness-native name). Used by
//                       `copyWorkspaceSidecars` to copy the existing
//                       content as a starting point.
//
// The schema field path is dot-notation: `personality` is top-level,
// `settings.extra_instructions` is nested.

export type HarnessSlug = 'openclaw';

export interface FieldMapping {
  /** Scaffold filename (wizard-field name, e.g. 'personality.md'). */
  filename: string;
  /** Source file in the agent workspace (harness name, e.g. 'SOUL.md'). */
  workspaceFilename: string;
  /** Dot-path inside the GRAFT `defaults` object. */
  schemaField: string;
}

/**
 * Static registry. Add a new harness by appending an entry. Each entry
 * lists ONLY the markdown-backed fields; structured config (channels,
 * model, thinking, skills) is read from the harness's own config file
 * by a separate per-harness extractor.
 */
export const FRAMEWORK_MAPPINGS: Record<HarnessSlug, ReadonlyArray<FieldMapping>> = {
  openclaw: [
    { filename: 'personality.md',         workspaceFilename: 'SOUL.md',     schemaField: 'personality' },
    { filename: 'vibe.md',                workspaceFilename: 'IDENTITY.md', schemaField: 'vibe' },
    { filename: 'extra_instructions.md',  workspaceFilename: 'AGENTS.md',   schemaField: 'settings.extra_instructions' },
  ],
};

export const SUPPORTED_HARNESSES = Object.keys(FRAMEWORK_MAPPINGS) as HarnessSlug[];

export function isSupportedHarness(slug: unknown): slug is HarnessSlug {
  return typeof slug === 'string' && (SUPPORTED_HARNESSES as readonly string[]).includes(slug);
}

export function mappingFor(harness: HarnessSlug): ReadonlyArray<FieldMapping> {
  return FRAMEWORK_MAPPINGS[harness];
}
