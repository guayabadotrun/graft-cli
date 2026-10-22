// HTTP client for `POST /api/grafts/validate`. Single source of truth
// for "is this envelope authorable?" — see
// convolution-api/app/Http/Controllers/API/Graft/ValidateGraftController.php.
//
// Uses the global `fetch` shipped with Node ≥18 (the CLI's stated min).
// No third-party HTTP deps: keeps the install footprint tiny.

import type { GraftPackage } from '../graft/package.js';
import {
  HttpResponseError,
  joinApiUrl,
  normaliseLaravelErrors,
  requestJson,
} from './http.js';

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
  /**
   * Account-level master API key. The endpoint is auth-gated: anonymous
   * validation is unsupported and returns 401.
   */
  apiKey?: string;
  /** Override fetch (mostly for tests). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Request timeout in milliseconds. Defaults to 60000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

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

export async function validateGraftPackage(
  pkg: GraftPackage,
  opts: ValidateClientOptions = {},
): Promise<ValidateResult> {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  const url = joinApiUrl('/grafts/validate');

  let response: Response;
  let body: unknown;
  try {
    ({ response, body } = await requestJson(
      fetchFn,
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: JSON.stringify(pkg),
      },
      {
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        label: 'Validate endpoint',
        htmlHint:
          'This usually means GUAYABA_API_BASE_URL points at a web frontend or reverse-proxy ' +
          'rather than the Laravel backend directly. ' +
          'Set GUAYABA_API_BASE_URL=https://<api-domain>/api/v1 and retry.',
        nonJsonHint:
          'Check that GUAYABA_API_BASE_URL points at the backend API (e.g. https://<api-domain>/api/v1).',
      },
    ));
  } catch (err) {
    if (err instanceof HttpResponseError) {
      throw new ValidateRequestError(err.message, err);
    }
    throw err;
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
