// GRAFT package envelope — what the CLI writes to disk and what a future
// `POST /grafts` endpoint will accept.
//
// The backend stores `metadata` as columns and `schema` as a single JSON
// column. We mirror that split
// on disk so the same file can be diffed by humans, validated by the
// CLI, and posted as-is.

import type { GraftDocument } from './build.js';

/**
 * Author-facing metadata. Mirrors the columns on the `grafts` table
 * (see `convolution-api/database/migrations/2026_04_21_000001_create_grafts_table.php`)
 * minus server-managed fields (`id`, `installs_count`, `created_at`,
 * `updated_at`, `author_id`, `status`).
 *
 * `status` is intentionally absent: a freshly exported GRAFT is always
 * a personal graft until the author submits it for marketplace review.
 *
 * `icon_path` / `cover_image_path` are S3 object keys, never URLs. During
 * `graft push --icon/--cover`, the CLI uploads assets before the bundle and
 * lets the backend persist the resulting keys.
 */
export interface GraftMetadata {
  slug: string;
  name: string;
  short_description?: string;
  description?: string;
  version: string;
  tags: string[];
  category_slugs: string[];
  harness_slugs: string[];
  author_name?: string;
  tier: 'free' | 'premium';
  price_credits: number;
  icon_path?: string;
  cover_image_path?: string;
}

/** What the CLI writes to disk. */
export interface GraftPackage {
  metadata: GraftMetadata;
  schema: GraftDocument;
}

/**
 * Offline fallback for the backend-seeded category slugs
 * (`GraftSeeder::seedCategories()`). The live list is fetched from
 * `GET /grafts/constants` at validate/push time (see
 * `src/api/constantsClient.ts`); this constant is only used when the API
 * is unreachable or the request fails.
 *
 * If the backend grows new categories, update the seeder first — the
 * CLI tolerates unknown values (warns but doesn't reject) so a
 * slightly-stale fallback doesn't block submissions.
 */
export const KNOWN_CATEGORY_SLUGS = [
  'productivity',
  'support',
  'social',
  'dev',
  'creative',
  'general',
] as const;

export type KnownCategorySlug = (typeof KNOWN_CATEGORY_SLUGS)[number];
