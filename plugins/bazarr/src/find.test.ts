import { describe, expect, it } from 'vitest';
import { findItem, reloadItem } from './find.ts';
import {
  BASE,
  ctxWith,
  EPISODE_FILE,
  EPISODE_ONE_URL,
  EPISODES_URL,
  fixture,
  MOVIE_FILE,
  MOVIE_ONE_URL,
  MOVIES_URL,
  SERIES_URL,
} from './test-util.ts';

const series = () => ({ match: { url: SERIES_URL }, body: fixture('series') });
const episodes = () => ({ match: { url: EPISODES_URL }, body: fixture('episodes') });
const movies = () => ({ match: { url: MOVIES_URL }, body: fixture('movies') });
const movieOne = () => ({ match: { url: MOVIE_ONE_URL }, body: fixture('movies-one') });

describe('findItem: series', () => {
  it('finds the episode with its subtitles', async () => {
    const ctx = ctxWith([series(), episodes()]);
    expect(await findItem(ctx, EPISODE_FILE, 'auto')).toEqual({
      kind: 'episode',
      seriesId: 1,
      episodeId: 11,
      title: 'Example Show S01E03',
      path: EPISODE_FILE,
      subtitles: [
        { language: 'eng', external: true, forced: false, sdh: false },
        { language: 'deu', external: false, forced: true, sdh: false },
      ],
    });
  });

  it('matches the series folder segment-aware: Example Show vs Example Show 2', async () => {
    const other = '/data/shows/Example Show 2/Season 1/Example Show 2 - S01E01.mkv';
    const ctx = ctxWith([
      series(),
      {
        match: { url: `${BASE}/api/episodes?seriesid[]=2` },
        body: {
          data: [
            {
              sonarrSeriesId: 2,
              sonarrEpisodeId: 21,
              season: 1,
              episode: 1,
              title: 'Pilot',
              path: other,
              subtitles: [],
            },
          ],
        },
      },
    ]);
    const hit = await findItem(ctx, other, 'series');
    expect(hit).toMatchObject({ kind: 'episode', seriesId: 2, episodeId: 21 });
    expect(ctx.calls.map((c) => c.url)).toEqual([SERIES_URL, `${BASE}/api/episodes?seriesid[]=2`]);
  });

  it('does not match a sibling folder that only shares a name prefix', async () => {
    const ctx = ctxWith([series()]);
    expect(await findItem(ctx, '/data/shows/Example Show 3/S01E01.mkv', 'series')).toBeNull();
  });

  it('returns null when the series is known but the episode file is not', async () => {
    const ctx = ctxWith([series(), episodes()]);
    expect(
      await findItem(ctx, '/data/shows/Example Show/Season 1/Example Show - S09E09.mkv', 'series'),
    ).toBeNull();
  });

  it('translates the path through the mappings: lookups use the remote path', async () => {
    const ctx = ctxWith(
      [
        {
          match: { url: SERIES_URL },
          body: {
            data: [{ sonarrSeriesId: 1, title: 'Example Show', path: '/tv/Example Show' }],
            total: 1,
          },
        },
        {
          match: { url: EPISODES_URL },
          body: {
            data: [
              {
                sonarrSeriesId: 1,
                sonarrEpisodeId: 11,
                season: 1,
                episode: 3,
                path: '/tv/Example Show/Season 1/Example Show - S01E03.mkv',
                subtitles: [],
              },
            ],
          },
        },
      ],
      { mappings: [{ remote: '/tv', local: '/data/shows' }] },
    );
    const hit = await findItem(ctx, EPISODE_FILE, 'auto');
    expect(hit?.path).toBe('/tv/Example Show/Season 1/Example Show - S01E03.mkv');
  });

  it('fetches the series list once for two lookups', async () => {
    const ctx = ctxWith([series(), episodes(), episodes()]);
    await findItem(ctx, EPISODE_FILE, 'auto');
    await findItem(ctx, EPISODE_FILE, 'auto');
    expect(ctx.calls.filter((c) => c.url === SERIES_URL)).toHaveLength(1);
    expect(ctx.calls.filter((c) => c.url === EPISODES_URL)).toHaveLength(2);
  });

  it('pages when length=-1 is ignored (total > data.length)', async () => {
    const row = (id: number) => ({
      sonarrSeriesId: id,
      title: `Page Show ${id}`,
      path: `/data/shows/Page Show ${id}`,
    });
    const ctx = ctxWith([
      { match: { url: SERIES_URL }, body: { data: [row(1), row(2)], total: 3 } },
      {
        match: { url: `${BASE}/api/series?start=2&length=500` },
        body: { data: [row(3)], total: 3 },
      },
      {
        match: { url: `${BASE}/api/episodes?seriesid[]=3` },
        body: {
          data: [
            {
              sonarrSeriesId: 3,
              sonarrEpisodeId: 31,
              season: 1,
              episode: 1,
              path: '/data/shows/Page Show 3/a.mkv',
              subtitles: [],
            },
          ],
        },
      },
    ]);
    const hit = await findItem(ctx, '/data/shows/Page Show 3/a.mkv', 'series');
    expect(hit).toMatchObject({ seriesId: 3, episodeId: 31 });
    expect(ctx.calls.map((c) => c.url)).toEqual([
      SERIES_URL,
      `${BASE}/api/series?start=2&length=500`,
      `${BASE}/api/episodes?seriesid[]=3`,
    ]);
  });

  it('stops paging on an empty page even when total is larger', async () => {
    const ctx = ctxWith([
      { match: { url: SERIES_URL }, body: { data: [], total: 5 } },
      { match: { url: `${BASE}/api/series?start=0&length=500` }, body: { data: [], total: 5 } },
    ]);
    expect(await findItem(ctx, '/data/shows/x/a.mkv', 'series')).toBeNull();
    expect(ctx.calls).toHaveLength(1);
  });

  describe('when the series list has no path (B3 fallback)', () => {
    const noPath = (...titles: string[]) => ({
      match: { url: SERIES_URL },
      body: {
        data: titles.map((title, i) => ({ sonarrSeriesId: i + 1, title })),
        total: titles.length,
      },
    });
    const file = '/data/shows/Example Show (2010)/Season 1/Example Show - S01E03.mkv';

    it('matches a unique title against the three nearest folder names, minus the year', async () => {
      const ctx = ctxWith([
        noPath('example show', 'Other Show'),
        {
          match: { url: EPISODES_URL },
          body: { data: [{ sonarrSeriesId: 1, sonarrEpisodeId: 5, path: file, subtitles: [] }] },
        },
      ]);
      expect(await findItem(ctx, file, 'series')).toMatchObject({ seriesId: 1, episodeId: 5 });
    });

    it('returns null when two series share the title', async () => {
      const ctx = ctxWith([noPath('Example Show', 'Example Show')]);
      expect(await findItem(ctx, file, 'series')).toBeNull();
    });

    it('returns null when no folder name matches', async () => {
      const ctx = ctxWith([noPath('Different Show')]);
      expect(await findItem(ctx, file, 'series')).toBeNull();
    });
  });
});

describe('findItem: movies', () => {
  it('matches a movie by its file path and loads its subtitles by id', async () => {
    const ctx = ctxWith([movies(), movieOne()]);
    expect(await findItem(ctx, MOVIE_FILE, 'movie')).toEqual({
      kind: 'movie',
      radarrId: 7,
      title: 'Example Movie (2001)',
      path: MOVIE_FILE,
      subtitles: [{ language: 'eng', external: true, forced: false, sdh: false }],
    });
    expect(ctx.calls.map((c) => c.url)).toEqual([MOVIES_URL, MOVIE_ONE_URL]);
  });

  it('auto tries series first, then movies', async () => {
    const ctx = ctxWith([series(), movies(), movieOne()]);
    expect(await findItem(ctx, MOVIE_FILE, 'auto')).toMatchObject({ kind: 'movie', radarrId: 7 });
    expect(ctx.calls.map((c) => c.url)).toEqual([SERIES_URL, MOVIES_URL, MOVIE_ONE_URL]);
  });

  it('kind=series never looks at movies, kind=movie never at series', async () => {
    const a = ctxWith([series()]);
    expect(await findItem(a, MOVIE_FILE, 'series')).toBeNull();
    expect(a.calls.map((c) => c.url)).toEqual([SERIES_URL]);
    const b = ctxWith([movies()]);
    expect(await findItem(b, '/data/movies/Nothing/Nothing.mkv', 'movie')).toBeNull();
    expect(b.calls.map((c) => c.url)).toEqual([MOVIES_URL]);
  });

  it('does not match a different file in the same folder', async () => {
    const ctx = ctxWith([movies()]);
    expect(await findItem(ctx, '/data/movies/Example Movie (2001)/Extras.mkv', 'movie')).toBeNull();
  });
});

describe('reloadItem', () => {
  it('re-reads an episode by id without the cache', async () => {
    const ctx = ctxWith([
      series(),
      episodes(),
      { match: { url: EPISODE_ONE_URL }, body: fixture('episodes') },
    ]);
    const item = await findItem(ctx, EPISODE_FILE, 'auto');
    expect(item).not.toBeNull();
    const again = await reloadItem(ctx, item as NonNullable<typeof item>);
    expect(again).toEqual(item);
    expect(ctx.calls.at(-1)?.url).toBe(EPISODE_ONE_URL);
  });

  it('re-reads a movie by radarrid and returns null when Bazarr no longer lists it', async () => {
    const ctx = ctxWith([
      movies(),
      movieOne(),
      { match: { url: MOVIE_ONE_URL }, body: { data: [] } },
    ]);
    const item = await findItem(ctx, MOVIE_FILE, 'movie');
    const reloaded = await reloadItem(ctx, item as NonNullable<typeof item>);
    expect(reloaded).toBeNull();
  });
});
