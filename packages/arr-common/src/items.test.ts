import { fakePluginContext } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { cachedItems, type JsonValue } from './index.ts';

const BASE = 'http://radarr:7878';
const settings = { url: BASE, apiKey: 'key-1', pathMappings: [], allowInsecureTls: false };
const slim = (r: JsonValue) =>
  typeof r === 'object' && r !== null && !Array.isArray(r) && typeof r.id === 'number'
    ? { id: r.id }
    : null;
const opts = { key: 'movies', path: '/api/v3/movie', slim };

describe('cachedItems', () => {
  it('keeps only what slim returns, drops what it rejects, and caches the slim list', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        { match: { url: `${BASE}/api/v3/movie` }, body: [{ id: 1, images: ['a'] }, { x: 1 }] },
      ],
    });
    expect(await cachedItems(ctx, 'Radarr', opts)).toEqual([{ id: 1 }]);
    expect(await ctx.cache.get('movies')).toEqual([{ id: 1 }]);
    expect(await cachedItems(ctx, 'Radarr', opts)).toEqual([{ id: 1 }]);
    expect(ctx.calls).toHaveLength(1);
  });

  it('gives an empty list for an answer that is not a list', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [{ match: { url: `${BASE}/api/v3/movie` }, body: { error: 'x' } }],
    });
    expect(await cachedItems(ctx, 'Radarr', opts)).toEqual([]);
  });
});
