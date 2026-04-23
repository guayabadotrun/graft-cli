// Pure helpers for deriving metadata defaults and shaping user input.
// No prompts, no IO. Format/length validation is intentionally NOT done
// here — the backend's GraftSchemaValidator + ValidateGraftRequest are
// the single source of truth, reachable via `graft init --validate <api>`
// or as part of submitting the GRAFT. Replicating those rules in TS would
// drift; the prompts layer only enforces "non-empty when required".

import type { OpenclawAgentSummary } from '../openclaw/extract.js';
import type { GraftMetadata } from './package.js';

/**
 * Turn an arbitrary display string into a kebab-case slug suitable for
 * the `grafts.slug` column (max 100 chars, [a-z0-9-]+, no leading/
 * trailing dashes). Best-effort default — backend has the final say.
 */
export function slugify(input: string): string {
  const lowered = input
    .normalize('NFKD')
    // Strip combining marks (accents).
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const ascii = lowered
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return ascii.slice(0, 100);
}

/** Split a comma- or whitespace-separated string into a clean tag list. */
export function parseTagsInput(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((t: string) => t.trim().toLowerCase())
    .filter((t: string) => t.length > 0);
}

/**
 * Build the default metadata block we suggest to the user before any
 * prompts run. Slug / name come from the agent; everything else is
 * either a sensible default or empty.
 */
export function defaultMetadataFor(summary: OpenclawAgentSummary): GraftMetadata {
  const displayName = summary.agent.name?.trim() ?? '';
  const baseSlug = displayName.length > 0 ? slugify(displayName) : '';
  return {
    slug: baseSlug,
    name: displayName,
    version: '0.1.0',
    tags: [],
    category_slugs: [],
    framework_slugs: [summary.framework],
    tier: 'free',
    price_credits: 0,
  };
}
