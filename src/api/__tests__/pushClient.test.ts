import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import {
  PushRequestError,
  pushGraftPackage,
} from '../pushClient.js';
import type { GraftPackage } from '../../graft/package.js';
import type { BuildGraftBundleInput, BuildGraftBundleResult } from '../../graft/bundle.js';

const DRAFT_URL = 'https://api.guayaba.run/api/v1/grafts/drafts';
const FAKE_BUNDLE_BYTES = Buffer.from('fake-tar-gz-bytes');

function pkg(): GraftPackage {
  return {
    metadata: {
      slug: 'my-graft',
      name: 'My Graft',
      version: '0.1.0',
      tags: [],
      category_slugs: [],
      framework_slugs: ['openclaw'],
      tier: 'free',
      price_credits: 0,
    },
    schema: {
      schema_version: 2,
      framework_constraints: ['openclaw'],
      defaults: { channels: ['chat'] },
      fields: [],
    },
  };
}

/**
 * Stub bundle builder so we don't need a real workspace, tar binary, or
 * tempdir. Returns a closed Readable stream of fixed bytes.
 */
function fakeBundleBuilder(): (input: BuildGraftBundleInput) => Promise<BuildGraftBundleResult> {
  return async () => ({
    stream: Readable.from([FAKE_BUNDLE_BYTES]),
    done: Promise.resolve(),
    skillCount: 0,
  });
}

function mockFetch(
  responder: (url: string, init: RequestInit) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return responder(url, init ?? {});
  });
  return { fetchImpl: spy as unknown as typeof fetch, spy: spy as unknown as ReturnType<typeof vi.fn> };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('pushGraftPackage — bundle only', () => {
  it('POSTs multipart bundle to the v1 drafts endpoint and returns 201 data', async () => {
    const { fetchImpl, spy } = mockFetch(() =>
      jsonResponse(201, {
        data: {
          id: 'graft-uuid',
          slug: 'my-graft',
          version: '0.1.0',
          version_id: 'version-uuid',
          bundle_s3_key: 'personal/u1/my-graft/0.1.0/graft.tar.gz',
          is_personal: true,
        },
      }),
    );

    const result = await pushGraftPackage(pkg(), '/tmp/ws', {}, {
      apiKey: 'k_master_x',
      fetchImpl,
      buildBundleImpl: fakeBundleBuilder(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).toBe('graft-uuid');
    expect(result.versionId).toBe('version-uuid');
    expect(result.bundleS3Key).toBe('personal/u1/my-graft/0.1.0/graft.tar.gz');
    expect(result.assets).toEqual([]);

    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe(DRAFT_URL);
    const reqInit = init as RequestInit;
    expect(reqInit.method).toBe('POST');
    expect(reqInit.headers).toMatchObject({
      Authorization: 'Bearer k_master_x',
      Accept: 'application/json',
    });
    // FormData body — fetch sets the multipart Content-Type itself, so we
    // must NOT have a manual Content-Type header (would break parsing).
    expect((reqInit.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(reqInit.body).toBeInstanceOf(FormData);
    const form = reqInit.body as FormData;
    expect(form.get('metadata')).toBe(JSON.stringify(pkg().metadata));
    expect(form.get('schema')).toBe(JSON.stringify(pkg().schema));
    const bundle = form.get('bundle');
    expect(bundle).toBeInstanceOf(Blob);
    expect((bundle as Blob).type).toBe('application/gzip');
    expect((bundle as Blob).size).toBe(FAKE_BUNDLE_BYTES.byteLength);
  });

  it('returns ok=false with flattened issues on 422', async () => {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse(422, {
        message: 'invalid',
        errors: { 'metadata.slug': ['Slug must be kebab-case.'] },
      }),
    );

    const result = await pushGraftPackage(pkg(), '/tmp/ws', {}, {
      apiKey: 'k',
      fetchImpl,
      buildBundleImpl: fakeBundleBuilder(),
    });

    expect(result).toEqual({
      ok: false,
      issues: [{ field: 'metadata.slug', message: 'Slug must be kebab-case.' }],
    });
  });

  it('hoists 409 version conflicts as structured issues, not exceptions', async () => {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse(409, {
        message: 'collision',
        errors: {
          'metadata.version': ['Version 0.1.0 already exists for this slug.'],
        },
      }),
    );

    const result = await pushGraftPackage(pkg(), '/tmp/ws', {}, {
      apiKey: 'k',
      fetchImpl,
      buildBundleImpl: fakeBundleBuilder(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.field).toBe('metadata.version');
  });

  it('throws PushRequestError on 401 with a clear message', async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse(401, { message: 'no' }));
    await expect(
      pushGraftPackage(pkg(), '/tmp/ws', {}, {
        apiKey: 'k',
        fetchImpl,
        buildBundleImpl: fakeBundleBuilder(),
      }),
    ).rejects.toThrow(PushRequestError);
  });

  it('throws PushRequestError on 403 (slave key)', async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse(403, { message: 'master only' }));
    await expect(
      pushGraftPackage(pkg(), '/tmp/ws', {}, {
        apiKey: 'k',
        fetchImpl,
        buildBundleImpl: fakeBundleBuilder(),
      }),
    ).rejects.toThrow(/master API key/);
  });

  it('throws PushRequestError on transport failure', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(
      pushGraftPackage(pkg(), '/tmp/ws', {}, {
        apiKey: 'k',
        fetchImpl,
        buildBundleImpl: fakeBundleBuilder(),
      }),
    ).rejects.toThrow(/Failed to reach/);
  });

  it('wraps bundle build errors in PushRequestError', async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse(201, { data: {} }));
    await expect(
      pushGraftPackage(pkg(), '/tmp/ws', {}, {
        apiKey: 'k',
        fetchImpl,
        buildBundleImpl: async () => {
          throw new Error('tar binary missing');
        },
      }),
    ).rejects.toThrow(/Failed to build GRAFT bundle: tar binary missing/);
  });
});

describe('pushGraftPackage — with assets', () => {
  let tmpDir: string;
  let iconPath: string;
  let coverPath: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'push-client-'));
    iconPath = join(tmpDir, 'icon.png');
    coverPath = join(tmpDir, 'cover.jpg');
    await writeFile(iconPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(coverPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('uploads icon then cover then bundle, in that order', async () => {
    const calls: string[] = [];
    const { fetchImpl } = mockFetch((url) => {
      calls.push(url);
      if (url.endsWith('/assets/icon')) {
        return jsonResponse(200, { data: { slug: 'my-graft', type: 'icon', path: 'personal/u1/my-graft/icon.png' } });
      }
      if (url.endsWith('/assets/cover')) {
        return jsonResponse(200, { data: { slug: 'my-graft', type: 'cover', path: 'personal/u1/my-graft/cover.jpg' } });
      }
      return jsonResponse(201, {
        data: {
          id: 'g1',
          slug: 'my-graft',
          version: '0.1.0',
          version_id: 'v1',
          bundle_s3_key: 'personal/u1/my-graft/0.1.0/graft.tar.gz',
        },
      });
    });

    const result = await pushGraftPackage(
      pkg(),
      '/tmp/ws',
      { iconPath, coverPath },
      { apiKey: 'k', fetchImpl, buildBundleImpl: fakeBundleBuilder() },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assets).toEqual([
      { type: 'icon', path: 'personal/u1/my-graft/icon.png' },
      { type: 'cover', path: 'personal/u1/my-graft/cover.jpg' },
    ]);
    // Bundle POST must be last — proves we don't build/upload the bundle
    // when assets fail.
    expect(calls).toEqual([
      'https://api.guayaba.run/api/v1/grafts/drafts/my-graft/assets/icon',
      'https://api.guayaba.run/api/v1/grafts/drafts/my-graft/assets/cover',
      DRAFT_URL,
    ]);
  });

  it('aborts before bundle when an asset is rejected with 422', async () => {
    const calls: string[] = [];
    const { fetchImpl } = mockFetch((url) => {
      calls.push(url);
      if (url.endsWith('/assets/icon')) {
        return jsonResponse(422, { errors: { file: ['Only PNG, JPG, and WebP images are allowed.'] } });
      }
      throw new Error('bundle endpoint must not be called');
    });

    const buildSpy = vi.fn(fakeBundleBuilder());
    const result = await pushGraftPackage(
      pkg(),
      '/tmp/ws',
      { iconPath },
      { apiKey: 'k', fetchImpl, buildBundleImpl: buildSpy as never },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.field).toBe('file');
    // Only the asset URL should have been hit and the bundle must not have
    // been built (expensive: spawns tar).
    expect(calls).toEqual([
      'https://api.guayaba.run/api/v1/grafts/drafts/my-graft/assets/icon',
    ]);
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('throws PushRequestError when the asset file does not exist on disk', async () => {
    const { fetchImpl } = mockFetch(() => {
      throw new Error('should not call fetch');
    });
    await expect(
      pushGraftPackage(
        pkg(),
        '/tmp/ws',
        { iconPath: join(tmpDir, 'does-not-exist.png') },
        { apiKey: 'k', fetchImpl, buildBundleImpl: fakeBundleBuilder() },
      ),
    ).rejects.toThrow(PushRequestError);
  });
});
