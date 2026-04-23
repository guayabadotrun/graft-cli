import { describe, expect, it, vi } from 'vitest';
import {
  ValidateRequestError,
  validateGraftPackage,
  type ValidateClientOptions,
} from '../validateClient.js';
import type { GraftPackage } from '../../graft/package.js';

const EXPECTED_URL = 'https://api.guayaba.run/api/v1/grafts/validate';

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
      defaults: { channels: ['telegram'] },
      fields: [],
    },
  };
}

function mockFetch(
  status: number,
  body: unknown,
): {
  fetchImpl: ValidateClientOptions['fetchImpl'];
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fetchImpl: spy as unknown as typeof fetch, spy: spy as unknown as ReturnType<typeof vi.fn> };
}

describe('validateGraftPackage', () => {
  it('POSTs to the hard-coded production URL with the API key as bearer', async () => {
    const { fetchImpl, spy } = mockFetch(200, { data: { valid: true, warnings: ['hi'] } });

    const result = await validateGraftPackage(pkg(), {
      apiKey: 'k_master_123',
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, warnings: ['hi'] });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe(EXPECTED_URL);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer k_master_123',
      'Content-Type': 'application/json',
    });
  });

  it('omits Authorization when no api key provided', async () => {
    const { fetchImpl, spy } = mockFetch(200, { data: { warnings: [] } });
    await validateGraftPackage(pkg(), { fetchImpl });
    const headers = (spy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('flattens Laravel 422 errors into ValidationIssue list', async () => {
    const { fetchImpl } = mockFetch(422, {
      message: 'invalid',
      errors: {
        'metadata.slug': ['Slug must be kebab-case.'],
        schema: ['schema_version must be exactly 2.'],
      },
    });

    const result = await validateGraftPackage(pkg(), { fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { field: 'metadata.slug', message: 'Slug must be kebab-case.' },
        { field: 'schema', message: 'schema_version must be exactly 2.' },
      ]),
    );
  });

  it('falls back to message when 422 has no errors map', async () => {
    const { fetchImpl } = mockFetch(422, { message: 'broken' });
    const result = await validateGraftPackage(pkg(), { fetchImpl });
    expect(result).toEqual({ ok: false, issues: [{ field: 'envelope', message: 'broken' }] });
  });

  it('throws ValidateRequestError on 401 with a helpful message', async () => {
    const { fetchImpl } = mockFetch(401, { message: 'Unauthenticated.' });
    await expect(
      validateGraftPackage(pkg(), { fetchImpl }),
    ).rejects.toBeInstanceOf(ValidateRequestError);
  });

  it('throws ValidateRequestError on unexpected status', async () => {
    const { fetchImpl } = mockFetch(500, {});
    await expect(
      validateGraftPackage(pkg(), { fetchImpl }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('wraps fetch failures into ValidateRequestError', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(
      validateGraftPackage(pkg(), { fetchImpl }),
    ).rejects.toThrow(/Failed to reach/);
  });
});
