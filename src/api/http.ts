// Shared HTTP plumbing for the GRAFT API clients: URL joining, the
// timeout signal, the HTML-response guard and Laravel error flattening.
// Each client keeps only its endpoint-specific status/body parsing.

import { API_BASE_URL } from '../config.js';

export class HttpResponseError extends Error {
  readonly originalCause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'HttpResponseError';
    this.originalCause = cause;
  }
}

export interface JsonRequestOptions {
  /** Request timeout in milliseconds. */
  timeoutMs: number;
  /** Endpoint label used in error messages, e.g. "Validate endpoint". */
  label: string;
  /** Hint appended when the response is an HTML page. */
  htmlHint: string;
  /** Hint appended when the response is not JSON. */
  nonJsonHint: string;
}

export function joinApiUrl(path: string): string {
  // API_BASE_URL already ends in `/api/v1`. Path is expected to start with `/`.
  return `${API_BASE_URL.replace(/\/+$/, '')}${path}`;
}

export function normaliseLaravelErrors(errors: unknown): { field: string; message: string }[] {
  if (!errors || typeof errors !== 'object') return [];
  const out: { field: string; message: string }[] = [];
  for (const [field, messages] of Object.entries(errors as Record<string, unknown>)) {
    if (Array.isArray(messages)) {
      for (const m of messages) {
        if (typeof m === 'string') out.push({ field, message: m });
      }
    }
  }
  return out;
}

export async function requestJson(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  opts: JsonRequestOptions,
): Promise<{ response: Response; body: unknown }> {
  if (typeof fetchFn !== 'function') {
    throw new HttpResponseError(
      'No fetch implementation available. Use Node.js 18+ or pass fetchImpl.',
    );
  }

  let response: Response;
  try {
    response = await fetchFn(url, {
      ...init,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    throw new HttpResponseError(`Failed to reach ${url}: ${(err as Error).message}`, err);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    throw new HttpResponseError(
      `${opts.label} returned an HTML page (HTTP ${response.status}). ${opts.htmlHint}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new HttpResponseError(
      `${opts.label} returned non-JSON response (HTTP ${response.status}). ${opts.nonJsonHint}`,
      err,
    );
  }

  return { response, body };
}
