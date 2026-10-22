// HTTP client for `GET /grafts/constants` — the backend's live GRAFT
// authoring whitelists (category slugs, harness slugs, channels, field
// keys…). Consumed by the CLI so local hints stay in sync with the
// backend instead of trusting a frozen copy; see `resolveCategorySlugs`
// for the offline-fallback contract.
//
// Uses the global `fetch` shipped with Node ≥18 (the CLI's stated min).
// No third-party HTTP deps: keeps the install footprint tiny.

import { KNOWN_CATEGORY_SLUGS } from '../graft/package.js';
import { HttpResponseError, joinApiUrl, requestJson } from './http.js';

/** Live authoring constants returned by `GET /grafts/constants`. */
export interface GraftConstants {
  schema_version: number;
  top_level_keys: string[];
  field_types: string[];
  field_keys: string[];
  placement_keys: string[];
  validation_keys: string[];
  predicate_operators: string[];
  owned_by_prefixes: string[];
  /** Channel slugs allowed in `defaults.channels[]`. */
  graft_channels: string[];
  /** Seeded marketplace categories. */
  category_slugs: string[];
  /** Harnesss whose runtime driver supports GRAFT bundles. */
  harness_slugs: string[];
}

export interface ConstantsClientOptions {
  /**
   * Account-level master API key. Optional: a missing or rejected key is
   * treated as "endpoint unavailable" by `resolveCategorySlugs`.
   */
  apiKey?: string;
  /** Override fetch (mostly for tests). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Request timeout in milliseconds. Defaults to 5000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Thrown when the constants endpoint can't be reached or returned an
 * unexpected shape. `resolveCategorySlugs` swallows it and falls back to
 * the compiled-in list.
 */
export class ConstantsRequestError extends Error {
  readonly originalCause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ConstantsRequestError';
    this.originalCause = cause;
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
}

/**
 * Fetch the live authoring constants. Throws {@link ConstantsRequestError}
 * on any failure — callers that want the offline fallback should use
 * {@link resolveCategorySlugs} instead.
 */
export async function fetchGraftConstants(
  opts: ConstantsClientOptions = {},
): Promise<GraftConstants> {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const url = joinApiUrl('/grafts/constants');

  let response: Response;
  let body: unknown;
  try {
    ({ response, body } = await requestJson(
      fetchFn,
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
        },
      },
      {
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        label: 'Constants endpoint',
        htmlHint:
          'This usually means GUAYABA_API_BASE_URL points at a web frontend or reverse-proxy ' +
          'rather than the Laravel backend directly.',
        nonJsonHint: 'Check that GUAYABA_API_BASE_URL points at the backend API.',
      },
    ));
  } catch (err) {
    if (err instanceof HttpResponseError) {
      throw new ConstantsRequestError(err.message, err);
    }
    throw err;
  }

  if (response.status === 401) {
    throw new ConstantsRequestError(
      'Constants endpoint rejected the API key. Check your account master API key.',
    );
  }

  if (response.status !== 200) {
    throw new ConstantsRequestError(
      `Constants endpoint returned unexpected HTTP ${response.status}.`,
    );
  }

  const raw = (body as { data?: unknown }).data;
  if (!raw || typeof raw !== 'object') {
    throw new ConstantsRequestError('Constants endpoint returned an unexpected payload shape.');
  }
  const data = raw as Record<string, unknown>;

  return {
    schema_version: typeof data.schema_version === 'number' ? data.schema_version : 2,
    top_level_keys: asStringArray(data.top_level_keys),
    field_types: asStringArray(data.field_types),
    field_keys: asStringArray(data.field_keys),
    placement_keys: asStringArray(data.placement_keys),
    validation_keys: asStringArray(data.validation_keys),
    predicate_operators: asStringArray(data.predicate_operators),
    owned_by_prefixes: asStringArray(data.owned_by_prefixes),
    graft_channels: asStringArray(data.graft_channels),
    category_slugs: asStringArray(data.category_slugs),
    harness_slugs: asStringArray(data.harness_slugs),
  };
}

/**
 * Resolve the category slugs to use for local hints: the live list from
 * `GET /grafts/constants` when reachable, otherwise the compiled-in
 * {@link KNOWN_CATEGORY_SLUGS} fallback (offline, auth failure, 5xx,
 * malformed payload…). Never throws.
 */
export async function resolveCategorySlugs(
  opts: ConstantsClientOptions = {},
): Promise<readonly string[]> {
  try {
    const constants = await fetchGraftConstants(opts);
    if (constants.category_slugs.length > 0) {
      return constants.category_slugs;
    }
  } catch {
    // Unreachable or unexpected response — keep working offline.
  }
  return KNOWN_CATEGORY_SLUGS;
}
