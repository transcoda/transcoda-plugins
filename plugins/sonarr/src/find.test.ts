import { fakePluginContext } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { findSeriesForPath } from './find.ts';
import { BASE, epFile, episode, get, SHOW, SHOW2, settings } from './test-util.ts';

describe('findSeriesForPath', () => {
  it('matches only the sibling series whose folder is the path prefix (segment-aware)', async () => {
    const f = epFile(30, 2, '/data/shows/Show 2/S01E01.mkv');
    const ctx = fakePluginContext({
      settings,
      responses: [
        get('/api/v3/series', [SHOW, SHOW2]),
        get('/api/v3/episodefile?seriesId=2', [f]),
        get('/api/v3/episode?seriesId=2&episodeFileId=30', [episode(1, 2, 30, 1)]),
      ],
    });
    const found = await findSeriesForPath(ctx, '/data/shows/Show 2/S01E01.mkv');
    expect(found?.series.id).toBe(2);
    expect(found?.file?.id).toBe(30);
    expect(found?.episodes).toBe('S01E01');
    expect(ctx.calls.map((c) => c.url)).not.toContain(`${BASE}/api/v3/episodefile?seriesId=1`);
  });

  it('does not pick a series for a string-prefix-only match', async () => {
    const ctx = fakePluginContext({ settings, responses: [get('/api/v3/series', [SHOW])] });
    expect(await findSeriesForPath(ctx, '/data/shows/Show 2/S01E01.mkv')).toBeNull();
  });

  it('uses the remote path through the path mappings', async () => {
    const tv = { ...SHOW, path: '/tv/Show' };
    const ctx = fakePluginContext({
      settings,
      mappings: [{ remote: '/tv', local: '/data/shows' }],
      responses: [
        get('/api/v3/series', [tv]),
        get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, '/tv/Show/S01E03.mkv')]),
        get('/api/v3/episode?seriesId=1&episodeFileId=5', [episode(1, 1, 5, 3)]),
      ],
    });
    const found = await findSeriesForPath(ctx, '/data/shows/Show/S01E03.mkv');
    expect(found?.file?.path).toBe('/tv/Show/S01E03.mkv');
    expect(found?.episodes).toBe('S01E03');
  });

  it('caches the series list across lookups', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        get('/api/v3/series', [SHOW]),
        get('/api/v3/episodefile?seriesId=1', []),
        get('/api/v3/episodefile?seriesId=1', []),
      ],
    });
    await findSeriesForPath(ctx, '/data/shows/Show/a.mkv');
    await findSeriesForPath(ctx, '/data/shows/Show/b.mkv');
    expect(ctx.calls.filter((c) => c.url === `${BASE}/api/v3/series`)).toHaveLength(1);
  });

  it('returns the series with no file and an empty episode label when the file is unknown', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [get('/api/v3/series', [SHOW]), get('/api/v3/episodefile?seriesId=1', [])],
    });
    const found = await findSeriesForPath(ctx, '/data/shows/Show/a.mkv');
    expect(found).toMatchObject({ file: null, episodes: '' });
  });

  it('labels a multi-episode file', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        get('/api/v3/series', [SHOW]),
        get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, '/data/shows/Show/a.mkv')]),
        get('/api/v3/episode?seriesId=1&episodeFileId=5', [
          episode(1, 1, 5, 3, 2),
          episode(2, 1, 5, 4, 2),
        ]),
      ],
    });
    expect((await findSeriesForPath(ctx, '/data/shows/Show/a.mkv'))?.episodes).toBe('S02E03E04');
  });

  it('labels only the episodes of this file when Sonarr returns the whole series', async () => {
    // Sonarr answers /episode?seriesId=… with every episode of the series and ignores
    // episodeFileId, so the label must come only from episodes whose episodeFileId matches.
    const ctx = fakePluginContext({
      settings,
      responses: [
        get('/api/v3/series', [SHOW]),
        get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, '/data/shows/Show/a.mkv')]),
        get('/api/v3/episode?seriesId=1&episodeFileId=5', [
          episode(1, 1, 9, 2, 0),
          episode(2, 1, 0, 3, 0),
          episode(3, 1, 7, 3),
          episode(4, 1, 5, 4),
          episode(5, 1, 8, 5),
          episode(6, 1, 6, 1, 2),
        ]),
      ],
    });
    expect((await findSeriesForPath(ctx, '/data/shows/Show/a.mkv'))?.episodes).toBe('S01E04');
  });

  it('labels a multi-episode file in episode order, ignoring other files', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        get('/api/v3/series', [SHOW]),
        get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, '/data/shows/Show/a.mkv')]),
        get('/api/v3/episode?seriesId=1&episodeFileId=5', [
          episode(1, 1, 7, 3),
          episode(2, 1, 5, 5),
          episode(3, 1, 5, 4),
          episode(4, 1, 8, 6),
        ]),
      ],
    });
    expect((await findSeriesForPath(ctx, '/data/shows/Show/a.mkv'))?.episodes).toBe('S01E04E05');
  });

  it('gives an empty label when no episode belongs to the file', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        get('/api/v3/series', [SHOW]),
        get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, '/data/shows/Show/a.mkv')]),
        get('/api/v3/episode?seriesId=1&episodeFileId=5', [episode(1, 1, 7, 3)]),
      ],
    });
    expect((await findSeriesForPath(ctx, '/data/shows/Show/a.mkv'))?.episodes).toBe('');
  });

  it('gives an empty label when the episode lookup fails', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        get('/api/v3/series', [SHOW]),
        get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, '/data/shows/Show/a.mkv')]),
        get('/api/v3/episode?seriesId=1&episodeFileId=5', null, 500),
      ],
    });
    const found = await findSeriesForPath(ctx, '/data/shows/Show/a.mkv');
    expect(found).toMatchObject({ episodes: '' });
    expect(found?.file?.id).toBe(5);
  });
});
