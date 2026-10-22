import { describe, expect, it, vi } from 'vitest';
import {
  ConstantsRequestError,
  fetchGraftConstants,
  resolveCategorySlugs,
  type ConstantsClientOptions,
} from '../constantsClient.js';
import { KNOWN_CATEGORY_SLUGS } from '../../graft/package.js';

const EXPECTED_URL = 'https://api.guayaba.run/api/v1/grafts/constants';

const DATA = {
  schema_version: 2,
  top_level_keys: ['schema_version'],
  field_types: ['text', 'secret'],
  field_keys: ['id', 'label'],
  placement_keys: ['wizard'],
  validation_keys: ['max_length'],
  predicate_operators: ['eq'],
  owned_by_prefixes: ['user.'],
  graft_channels: ['telegram'],
  category_slugs: ['productivity', 'dev'],
  harness_slugs: ['openclaw'],
};

function mockFetch(
  status: number,
  body: unknown,
): {
  fetchImpl: ConstantsClientOptions['fetchImpl'];
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

describe('fetchGraftConstants', () => {
  it('GETs the production URL with the API key as bearer', async () => {
    const { fetchImpl, spy } = mockFetch(200, { data: DATA });

    const constants = await fetchGraftConstants({ apiKey: 'g_master_123', fetchImpl });

    expect(constants.category_slugs).toEqual(['productivity', 'dev']);
    expect(constants.graft_channels).toEqual(['telegram']);
    expect(constants.harness_slugs).toEqual(['openclaw']);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe(EXPECTED_URL);
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer g_master_123',
    });
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('omits Authorization when no api key provided', async () => {
    const { fetchImpl, spy } = mockFetch(200, { data: DATA });
    await fetchGraftConstants({ fetchImpl });
    const headers = (spy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('throws ConstantsRequestError on 401 with a helpful message', async () => {
    const { fetchImpl } = mockFetch(401, { message: 'Unauthenticated.' });
    await expect(fetchGraftConstants({ fetchImpl })).rejects.toBeInstanceOf(ConstantsRequestError);
  });

  it('throws ConstantsRequestError on unexpected status', async () => {
    const { fetchImpl } = mockFetch(500, {});
    await expect(fetchGraftConstants({ fetchImpl })).rejects.toThrow(/HTTP 500/);
  });

  it('throws ConstantsRequestError when the data payload is missing', async () => {
    const { fetchImpl } = mockFetch(200, {});
    await expect(fetchGraftConstants({ fetchImpl })).rejects.toThrow(/payload shape/);
  });

  it('wraps fetch failures into ConstantsRequestError', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(fetchGraftConstants({ fetchImpl })).rejects.toThrow(/Failed to reach/);
  });
});

describe('resolveCategorySlugs', () => {
  it('returns the live slugs when the endpoint responds', async () => {
    const { fetchImpl } = mockFetch(200, { data: DATA });
    await expect(resolveCategorySlugs({ fetchImpl })).resolves.toEqual(['productivity', 'dev']);
  });

  it('falls back to the compiled-in list when the network fails', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(resolveCategorySlugs({ fetchImpl })).resolves.toEqual(KNOWN_CATEGORY_SLUGS);
  });

  it('falls back to the compiled-in list when the endpoint errors', async () => {
    const { fetchImpl } = mockFetch(500, { message: 'boom' });
    await expect(resolveCategorySlugs({ fetchImpl })).resolves.toEqual(KNOWN_CATEGORY_SLUGS);
  });

  it('falls back to the compiled-in list when the live list is empty', async () => {
    const { fetchImpl } = mockFetch(200, { data: { ...DATA, category_slugs: [] } });
    await expect(resolveCategorySlugs({ fetchImpl })).resolves.toEqual(KNOWN_CATEGORY_SLUGS);
  });
});
