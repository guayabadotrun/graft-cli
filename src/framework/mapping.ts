// Framework → GRAFT field mapping registry.
//
// Each supported framework declares which on-disk markdown files (in the
// agent workspace AND in the scaffold the dev edits) carry which GRAFT
// schema field.
//
// Files keep their original framework name (SOUL.md, IDENTITY.md, ...)
// so the dev sees something familiar in the scaffold. The CLI does the
// mapping internally at validate/pack time.
//
// The schema field path is dot-notation: `personality` is top-level,
// `settings.extra_instructions` is nested.

export type FrameworkSlug = 'openclaw';

export interface FieldMapping {
  /** Workspace-relative filename (e.g. 'SOUL.md'). */
  filename: string;
  /** Dot-path inside the GRAFT `defaults` object. */
  schemaField: string;
}

/**
 * Static registry. Add a new framework by appending an entry. Each entry
 * lists ONLY the markdown-backed fields; structured config (channels,
 * model, thinking, skills) is read from the framework's own config file
 * by a separate per-framework extractor.
 */
export const FRAMEWORK_MAPPINGS: Record<FrameworkSlug, ReadonlyArray<FieldMapping>> = {
  openclaw: [
    { filename: 'SOUL.md', schemaField: 'personality' },
    { filename: 'IDENTITY.md', schemaField: 'vibe' },
    { filename: 'AGENTS.md', schemaField: 'settings.extra_instructions' },
  ],
};

export const SUPPORTED_FRAMEWORKS = Object.keys(FRAMEWORK_MAPPINGS) as FrameworkSlug[];

export function isSupportedFramework(slug: unknown): slug is FrameworkSlug {
  return typeof slug === 'string' && (SUPPORTED_FRAMEWORKS as readonly string[]).includes(slug);
}

export function mappingFor(framework: FrameworkSlug): ReadonlyArray<FieldMapping> {
  return FRAMEWORK_MAPPINGS[framework];
}
