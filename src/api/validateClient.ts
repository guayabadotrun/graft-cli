// HTTP client for `POST /api/grafts/validate`. Single source of truth
// for "is this envelope authorable?" — see
// convolution-api/app/Http/Controllers/API/Graft/ValidateGraftController.php.
//
// Uses the global `fetch` shipped with Node ≥18 (the CLI's stated min).
// No third-party HTTP deps: keeps the install footprint tiny.

import type { GraftPackage } from '../graft/package.js';
import { API_BASE_URL } from '../config.js';

/** A single validation problem returned by the backend. */
export interface ValidationIssue {
  /** Pointer like "metadata.slug" or "schema". Free-form, taken from the API. */
  field: string;
  /** Human-readable message ready to surface in CLI output. */
  message: string;
}

export type ValidateResult =
  | {
      ok: true;
      /** Soft warnings (e.g. unknown category slug). Non-blocking. */
      warnings: string[];
    }
  | {
      ok: false;
      issues: ValidationIssue[];
    };

export interface ValidateClientOptions {
  /** Account-level master API key. The endpoint is auth-gated. */
  apiKey?: string;
  /** Override fetch (mostly for tests). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Thrown when the validate endpoint can't be reached or returned an
 * unexpected shape (network error, 5xx, malformed JSON). Distinct from
 * a successful 422 — those are returned as `{ ok: false, issues }`.
 */
export class ValidateRequestError extends Error {
  readonly originalCause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ValidateRequestError';
    this.originalCause = cause;
  }
}

function joinUrl(path: string): string {
  // API_BASE_URL already ends in `/api`. Path is expected to start with `/`.
  return `${API_BASE_URL.replace(/\/+$/, '')}${path}`;
}

/**
 * Convert Laravel's `errors: { "field": ["msg", ...] }` shape into a flat
 * issue list ordered by field name for stable CLI output.
 */
function normaliseLaravelErrors(errors: unknown): ValidationIssue[] {
  if (!errors || typeof errors !== 'object') return [];
  const out: ValidationIssue[] = [];
  for (const [field, messages] of Object.entries(errors as Record<string, unknown>)) {
    if (Array.isArray(messages)) {
      for (const m of messages) {
        if (typeof m === 'string') out.push({ field, message: m });
      }
    }
  }
  return out;
}

export async function validateGraftPackage(
  pkg: GraftPackage,
  opts: ValidateClientOptions = {},
): Promise<ValidateResult> {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new ValidateRequestError(
      'No fetch implementation available. Use Node.js 18+ or pass fetchImpl.',
    );
  }

  const url = joinUrl('/grafts/validate');

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify(pkg),
    });
  } catch (err) {
    throw new ValidateRequestError(`Failed to reach ${url}: ${(err as Error).message}`, err);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new ValidateRequestError(
      `Validate endpoint returned non-JSON response (HTTP ${response.status}).`,
      err,
    );
  }

  if (response.status === 200) {
    const data = (body as { data?: { warnings?: unknown } }).data ?? {};
    const warnings = Array.isArray(data.warnings)
      ? (data.warnings.filter((w): w is string => typeof w === 'string'))
      : [];
    return { ok: true, warnings };
  }

  if (response.status === 422) {
    const issues = normaliseLaravelErrors((body as { errors?: unknown }).errors);
    if (issues.length === 0) {
      const message =
        typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : 'Validation failed.';
      issues.push({ field: 'envelope', message });
    }
    return { ok: false, issues };
  }

  if (response.status === 401) {
    throw new ValidateRequestError(
      'Validate endpoint rejected the API key. Check your account master API key.',
    );
  }

  throw new ValidateRequestError(
    `Validate endpoint returned unexpected HTTP ${response.status}.`,
  );
}
