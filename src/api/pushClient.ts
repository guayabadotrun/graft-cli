// HTTP client for `POST /api/v1/grafts/drafts` and
// `PUT /api/v1/grafts/drafts/{slug}/assets/{type}` — pushes a complete,
// versioned GRAFT bundle (built locally from a workspace) and its optional
// icon / cover artwork to the author's personal area on the Guayaba backend.
//
// Wire format for the draft endpoint: `multipart/form-data` with three
// fields — `bundle` (the tar.gz produced by `buildGraftBundle`), `metadata`
// (JSON string) and `schema` (JSON string). The backend treats `bundle` as
// opaque bytes; metadata + schema are validated server-side by the same
// FormRequest the manager UI uses.
//
// No third-party HTTP deps. FormData / Blob are global on Node 18+.

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import type { GraftPackage } from '../graft/package.js';
import { buildGraftBundle } from '../graft/bundle.js';
import { API_BASE_URL } from '../config.js';

export interface PushClientOptions {
  /** Account-level master API key. Required by the v1 endpoint. */
  apiKey: string;
  /** Override fetch (for tests). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * Override the bundle builder (tests). Defaults to graft-cli's
   * `buildGraftBundle`. Tests pass a stub that returns a fixed Buffer
   * stream so they don't need a real tar binary or workspace on disk.
   */
  buildBundleImpl?: typeof buildGraftBundle;
}

export interface PushAssets {
  /** Absolute path to an icon image (PNG/JPG/WebP, ≤ 1 MB). */
  iconPath?: string;
  /** Absolute path to a cover image (PNG/JPG/WebP, ≤ 4 MB). */
  coverPath?: string;
}

export interface PushedAsset {
  type: 'icon' | 'cover';
  path: string; // S3 key returned by the backend
}

export type PushResult =
  | {
      ok: true;
      slug: string;
      version: string;
      /** Graft row UUID. Stable across versions of the same slug. */
      id: string;
      /** Newly created GraftVersion row UUID. */
      versionId: string;
      /** S3 key of the uploaded `graft.tar.gz`. */
      bundleS3Key: string;
      assets: PushedAsset[];
    }
  | {
      ok: false;
      /** Same shape as ValidationIssue from validateClient — flatter for CLI rendering. */
      issues: { field: string; message: string }[];
    };

/**
 * Errors that aren't a normal 422/409 outcome: network failures, 5xx,
 * malformed JSON, missing asset files, bundle build failures. 422 / 409
 * land in `{ ok: false }`.
 */
export class PushRequestError extends Error {
  readonly originalCause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'PushRequestError';
    this.originalCause = cause;
  }
}

function joinUrl(path: string): string {
  // API_BASE_URL ends in `/api/v1`. Push routes live under that prefix.
  return `${API_BASE_URL.replace(/\/+$/, '')}${path}`;
}

function normaliseLaravelErrors(errors: unknown): { field: string; message: string }[] {
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

function mimeFor(filename: string): string {
  const ext = extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  // Backend rejects anything not in the above set; let it return the 422
  // rather than guessing here.
  return 'application/octet-stream';
}

/**
 * Drain a Readable stream into a single Buffer. We need a Buffer (not a
 * stream) because Node's global `fetch` cannot compute the multipart
 * Content-Length from a streaming body and Laravel's multipart parser
 * needs it. Bundles are size-capped at 200 MB by the backend, so the
 * memory cost is bounded and predictable.
 */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Upload a single asset. Throws PushRequestError on transport failure,
 * returns the structured success / 422 outcome otherwise.
 */
async function uploadAsset(
  slug: string,
  type: 'icon' | 'cover',
  filePath: string,
  opts: PushClientOptions,
): Promise<{ ok: true; path: string } | { ok: false; issues: { field: string; message: string }[] }> {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new PushRequestError(
      'No fetch implementation available. Use Node.js 18+ or pass fetchImpl.',
    );
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch (err) {
    throw new PushRequestError(`Could not read asset file ${filePath}: ${(err as Error).message}`, err);
  }

  const filename = basename(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeFor(filename) }), filename);

  const url = joinUrl(`/grafts/drafts/${encodeURIComponent(slug)}/assets/${type}`);

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
        // Don't set Content-Type — fetch fills in `multipart/form-data; boundary=...`
        // automatically when the body is FormData. Setting it manually breaks parsing.
      },
      body: form,
    });
  } catch (err) {
    throw new PushRequestError(`Failed to reach ${url}: ${(err as Error).message}`, err);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new PushRequestError(
      `Asset endpoint returned non-JSON response (HTTP ${response.status}).`,
      err,
    );
  }

  if (response.status === 200) {
    const path =
      (body as { data?: { path?: unknown } }).data?.path ?? '';
    return { ok: true, path: typeof path === 'string' ? path : '' };
  }

  if (response.status === 422) {
    const issues = normaliseLaravelErrors((body as { errors?: unknown }).errors);
    if (issues.length === 0) {
      issues.push({ field: 'file', message: `Asset rejected (HTTP 422).` });
    }
    return { ok: false, issues };
  }

  if (response.status === 401) {
    throw new PushRequestError(
      'Asset endpoint rejected the API key. Check your account master API key.',
    );
  }

  if (response.status === 403) {
    throw new PushRequestError(
      'Asset endpoint requires a master API key. Slave keys cannot push.',
    );
  }

  throw new PushRequestError(
    `Asset endpoint returned unexpected HTTP ${response.status}.`,
  );
}

/**
 * Push a GRAFT package + the workspace it was generated from to the
 * author's personal storage on the Guayaba backend.
 *
 * Strategy: assets first, bundle second. If any asset upload fails with a
 * structured error (422), we return immediately without building the bundle
 * — same behaviour as the manager UI. Building the bundle is non-trivial
 * (spawns `tar`, walks skills) so we only pay that cost once we're sure the
 * artwork won't be rejected.
 */
export async function pushGraftPackage(
  pkg: GraftPackage,
  workspacePath: string,
  assets: PushAssets,
  opts: PushClientOptions,
): Promise<PushResult> {
  const fetchFn = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new PushRequestError(
      'No fetch implementation available. Use Node.js 18+ or pass fetchImpl.',
    );
  }

  const slug = pkg.metadata.slug;
  const uploaded: PushedAsset[] = [];

  if (assets.iconPath) {
    const res = await uploadAsset(slug, 'icon', assets.iconPath, opts);
    if (!res.ok) return { ok: false, issues: res.issues };
    uploaded.push({ type: 'icon', path: res.path });
  }
  if (assets.coverPath) {
    const res = await uploadAsset(slug, 'cover', assets.coverPath, opts);
    if (!res.ok) return { ok: false, issues: res.issues };
    uploaded.push({ type: 'cover', path: res.path });
  }

  // Build the bundle into memory. The bundle builder also handles tempdir
  // cleanup internally — see graft/bundle.ts. Failures here surface as
  // PushRequestError so the CLI can exit cleanly without a stack trace.
  const buildFn = opts.buildBundleImpl ?? buildGraftBundle;
  let bundleBytes: Buffer;
  try {
    const built = await buildFn({
      workspacePath,
      metadata: pkg.metadata,
      schema: pkg.schema,
    });
    [bundleBytes] = await Promise.all([streamToBuffer(built.stream), built.done]);
  } catch (err) {
    throw new PushRequestError(
      `Failed to build GRAFT bundle: ${(err as Error).message}`,
      err,
    );
  }

  const url = joinUrl('/grafts/drafts');
  const form = new FormData();
  form.append('metadata', JSON.stringify(pkg.metadata));
  form.append('schema', JSON.stringify(pkg.schema));
  form.append('bundle', new Blob([bundleBytes], { type: 'application/gzip' }), 'graft.tar.gz');

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        // No Content-Type — fetch fills in the multipart boundary itself.
        Accept: 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: form,
    });
  } catch (err) {
    throw new PushRequestError(`Failed to reach ${url}: ${(err as Error).message}`, err);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new PushRequestError(
      `Push endpoint returned non-JSON response (HTTP ${response.status}).`,
      err,
    );
  }

  if (response.status === 201) {
    const data = (body as { data?: Record<string, unknown> }).data ?? {};
    return {
      ok: true,
      id: typeof data.id === 'string' ? data.id : '',
      slug: typeof data.slug === 'string' ? data.slug : slug,
      version: typeof data.version === 'string' ? data.version : pkg.metadata.version,
      versionId: typeof data.version_id === 'string' ? data.version_id : '',
      bundleS3Key: typeof data.bundle_s3_key === 'string' ? data.bundle_s3_key : '',
      assets: uploaded,
    };
  }

  if (response.status === 422 || response.status === 409) {
    const issues = normaliseLaravelErrors((body as { errors?: unknown }).errors);
    if (issues.length === 0) {
      const message =
        typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : `Push rejected (HTTP ${response.status}).`;
      issues.push({ field: 'envelope', message });
    }
    return { ok: false, issues };
  }

  if (response.status === 401) {
    throw new PushRequestError(
      'Push endpoint rejected the API key. Check your account master API key.',
    );
  }

  if (response.status === 403) {
    throw new PushRequestError(
      'Push endpoint requires a master API key. Slave keys cannot push.',
    );
  }

  throw new PushRequestError(
    `Push endpoint returned unexpected HTTP ${response.status}.`,
  );
}
