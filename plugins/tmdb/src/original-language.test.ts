import { nodeMetadata } from '@transcoda/sdk';
import { fakeHookContext, fakePluginContext, runData } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { readFixture } from './fixture.ts';
import plugin, { originalLanguage } from './index.ts';

const KEY = '0123456789abcdef0123456789abcdef';

describe('tmdb:original-language', () => {
  it('declares a data node with optional ids and title inputs and one language output', () => {
    const meta = nodeMetadata(originalLanguage);
    expect(meta.kind).toBe('data');
    expect(meta.hooks).toEqual(['data']);
    expect(meta.inputs.map((i) => [i.id, i.type, i.required])).toEqual([
      ['ids', 'data:ids', false],
      ['title', 'data:text', false],
    ]);
    expect(meta.outputs).toEqual([
      { id: 'language', label: 'Original language', type: 'data:language' },
    ]);
    expect(plugin.nodes).toHaveLength(1);
  });

  it('looks up by TMDB id from connected data', async () => {
    const plugin = fakePluginContext({
      settings: { credential: KEY },
      responses: [
        { match: { url: /\/3\/movie\/603\?/ }, body: readFixture('tmdb/movie-603.json') },
        { match: { url: /\/3\/tv\/603\?/ }, status: 404 },
      ],
    });
    const ctx = fakeHookContext({ plugin, data: { ids: { tmdbId: 603 }, title: 'unknown' } });
    await expect(runData(originalLanguage, ctx, {})).resolves.toEqual({
      value: 'eng',
      reason: 'by TMDB id 603',
    });
  });

  it('outputs unknown with a reason when nothing is found', async () => {
    const plugin = fakePluginContext({
      settings: { credential: KEY },
      responses: [
        {
          match: { url: /\/3\/search\/movie\?/ },
          body: readFixture('tmdb/search-movie-none.json'),
        },
      ],
    });
    const ctx = fakeHookContext({
      plugin,
      data: { ids: 'unknown', title: 'unknown' },
      file: {
        path: '/data/movies/Nope (2001)/Nope.2001.mkv',
        sizeBytes: 1,
        mtime: '2026-10-17T00:00:00.000Z',
        nlink: 1,
      },
    });
    const result = await runData(originalLanguage, ctx, { kind: 'movie' });
    expect(result).toEqual({ value: 'unknown', reason: 'no TMDB match for "Nope" (2001)' });
  });

  it('rejects an unknown kind setting', async () => {
    const ctx = fakeHookContext({ plugin: fakePluginContext({ settings: { credential: KEY } }) });
    await expect(runData(originalLanguage, ctx, { kind: 'anime' })).rejects.toThrow();
  });
});
