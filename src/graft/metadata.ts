// Pure helpers for deriving metadata defaults + validating user-entered
// metadata fields. No prompts, no IO — the prompts layer wraps these.

import type { OpenclawAgentSummary } from '../openclaw/extract.js';
import type { GraftMetadata } from './package.js';

/**
 * Turn an arbitrary display string into a kebab-case slug suitable for
 * the `grafts.slug` column (max 100 chars, [a-z0-9-]+, no leading/
 * trailing dashes, no double dashes).
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

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Returns an error message string when invalid, undefined when ok. */
export function validateSlug(value: string): string | undefined {
  if (value.length === 0) return 'Slug is required.';
  if (value.length > 100) return 'Slug must be 100 characters or fewer.';
  if (!SLUG_RE.test(value)) {
    return 'Slug must be kebab-case (lowercase letters, digits, hyphens; no leading or trailing dash).';
  }
  return undefined;
}

export function validateName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Name is required.';
  if (trimmed.length > 150) return 'Name must be 150 characters or fewer.';
  return undefined;
}

export function validateShortDescription(value: string): string | undefined {
  if (value.length > 255) return 'Short description must be 255 characters or fewer.';
  return undefined;
}

export function validateVersion(value: string): string | undefined {
  if (!SEMVER_RE.test(value)) {
    return 'Version must be semver, e.g. 0.1.0 or 1.2.3-beta.1.';
  }
  if (value.length > 30) return 'Version must be 30 characters or fewer.';
  return undefined;
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
