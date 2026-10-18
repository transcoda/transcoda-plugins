import { coalesceReset } from '@transcoda/plugin-arr-common';
import { beforeEach, describe, expect, it } from 'vitest';
import { findMovieForPath } from './find.ts';
import { BASE, ctxWith, fixture, movies } from './test-support.ts';

const MOVIE_URL = `${BASE}/api/v3/movie`;
const FILE_URL = `${BASE}/api/v3/moviefile?movieId=11`;
const FILE = '/data/movies/Example Movie (2019)/Example Movie (2019).mkv';

beforeEach(() => coalesceReset());

describe('findMovieForPath', () => {
  it('matches a movie by the path of its movie file', async () => {
    const withFile = movies({ movieFile: { id: 501, path: FILE } });
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: withFile },
      { match: { url: FILE_URL }, body: fixture('moviefile') },
    ]);
    const found = await findMovieForPath(ctx, FILE);
    expect(found?.movie).toMatchObject({ id: 11, title: 'Example Movie', year: 2019 });
    expect(found?.file).toEqual({ id: 501, path: FILE });
  });

  it('matches by the movie folder when movieFile is absent', async () => {
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: fixture('movie') },
      { match: { url: FILE_URL }, body: fixture('moviefile') },
    ]);
    const found = await findMovieForPath(ctx, FILE);
    expect(found?.movie.id).toBe(11);
    expect(found?.file?.id).toBe(501);
  });

  it('matches only whole folder names', async () => {
    const [m] = fixture('movie') as Array<Record<string, unknown>>;
    const sibling = { ...m, id: 12, path: '/data/movies/Example Movie (2019) Extended' };
    const ctx = ctxWith([{ match: { url: MOVIE_URL }, body: [sibling] as never }]);
    expect(await findMovieForPath(ctx, FILE)).toBeNull();
  });

  it('prefers the exact movie file over a folder match', async () => {
    const [m] = fixture('movie') as Array<Record<string, unknown>>;
    const other = {
      ...m,
      id: 12,
      title: 'Other',
      path: '/data/movies',
      movieFile: { id: 777, path: FILE },
    };
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: [m, other] as never },
      { match: { url: `${BASE}/api/v3/moviefile?movieId=12` }, body: [{ id: 777, path: FILE }] },
    ]);
    const found = await findMovieForPath(ctx, FILE);
    expect(found?.movie.id).toBe(12);
  });

  it('returns the movie with no file when the file is not listed', async () => {
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: fixture('movie') },
      { match: { url: FILE_URL }, body: [] },
    ]);
    const found = await findMovieForPath(ctx, FILE);
    expect(found?.movie.id).toBe(11);
    expect(found?.file).toBeNull();
  });

  it('returns null for an unknown path', async () => {
    const ctx = ctxWith([{ match: { url: MOVIE_URL }, body: fixture('movie') }]);
    expect(await findMovieForPath(ctx, '/elsewhere/x.mkv')).toBeNull();
  });

  it('applies the path mapping before looking up', async () => {
    const ctx = ctxWith(
      [
        { match: { url: MOVIE_URL }, body: fixture('movie') },
        { match: { url: FILE_URL }, body: fixture('moviefile') },
      ],
      { mappings: [{ remote: '/data/movies', local: '/movies' }] },
    );
    const found = await findMovieForPath(
      ctx,
      '/movies/Example Movie (2019)/Example Movie (2019).mkv',
    );
    expect(found?.file?.path).toBe(FILE);
  });

  it('caches the movie list between lookups', async () => {
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: fixture('movie') },
      { match: { url: FILE_URL }, body: fixture('moviefile') },
      { match: { url: FILE_URL }, body: fixture('moviefile') },
    ]);
    await findMovieForPath(ctx, FILE);
    await findMovieForPath(ctx, FILE);
    expect(ctx.calls.filter((c) => c.url === MOVIE_URL)).toHaveLength(1);
    expect(ctx.calls.filter((c) => c.url === FILE_URL)).toHaveLength(2);
  });

  it('a file path with a trailing slash difference still matches the file', async () => {
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: fixture('movie') },
      { match: { url: FILE_URL }, body: fixture('moviefile') },
    ]);
    const found = await findMovieForPath(ctx, `${FILE}/`);
    expect(found?.file?.id).toBe(501);
  });
});
