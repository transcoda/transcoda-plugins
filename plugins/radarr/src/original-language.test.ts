import { coalesceReset } from '@transcoda/plugin-arr-common';
import { fakeHookContext, runData } from '@transcoda/sdk/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { originalLanguage } from './original-language.ts';
import { BASE, ctxWith, fixture, movies } from './test-support.ts';

const MOVIE_URL = `${BASE}/api/v3/movie`;
const FILE = '/data/movies/Example Movie (2019)/Example Movie (2019).mkv';
const dataCtx = (plugin: ReturnType<typeof ctxWith>, path = FILE) =>
  fakeHookContext({
    plugin,
    file: { path, sizeBytes: 1, mtime: '2026-10-17T00:00:00.000Z', nlink: 1 },
  });

beforeEach(() => coalesceReset());

describe('radarr:original-language', () => {
  it('outputs language, title and ids', async () => {
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: movies() },
      { match: { url: /moviefile/ }, body: fixture('moviefile') },
    ]);
    const res = await runData(originalLanguage, dataCtx(ctx), {});
    expect(res.value).toEqual({
      language: 'jpn',
      title: 'Example Movie (2019)',
      ids: { tmdbId: 603, imdbId: 'tt0000003' },
    });
    expect(res.reason).toContain('Japanese');
  });

  it('gives unknown for a language Radarr reports as Unknown', async () => {
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: movies({ originalLanguage: { id: 0, name: 'Unknown' } }) },
    ]);
    const res = await runData(originalLanguage, dataCtx(ctx), {});
    expect(res.value).toMatchObject({ language: 'unknown', title: 'Example Movie (2019)' });
  });

  it('gives unknown for everything when Radarr does not know the path', async () => {
    const ctx = ctxWith([{ match: { url: MOVIE_URL }, body: movies() }]);
    const res = await runData(originalLanguage, dataCtx(ctx, '/data/other/x.mkv'), {});
    expect(res).toEqual({
      value: { language: 'unknown', title: 'unknown', ids: 'unknown' },
      reason: 'Radarr does not know /data/other/x.mkv',
    });
  });

  it('reports the remote (mapped) path in the reason', async () => {
    const ctx = ctxWith([{ match: { url: MOVIE_URL }, body: movies() }], {
      mappings: [{ remote: '/data/movies', local: '/movies' }],
    });
    const res = await runData(originalLanguage, dataCtx(ctx, '/other/x.mkv'), {});
    expect(res.reason).toBe('Radarr does not know /other/x.mkv');
  });

  it('never throws on an unreachable Radarr', async () => {
    const ctx = ctxWith([]);
    const res = await runData(originalLanguage, dataCtx(ctx), {});
    expect(res).toEqual({
      value: { language: 'unknown', title: 'unknown', ids: 'unknown' },
      reason: 'Radarr unreachable: failed',
    });
  });

  it('never throws on an error answer', async () => {
    const ctx = ctxWith([{ match: { url: MOVIE_URL }, status: 500 }]);
    const res = await runData(originalLanguage, dataCtx(ctx), {});
    expect(res.value).toEqual({ language: 'unknown', title: 'unknown', ids: 'unknown' });
    expect(res.reason).toContain('500');
  });
});
