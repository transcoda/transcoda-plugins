import { fakePluginContext, type ScriptedResponse } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { readFixture } from './fixture.ts';
import { fold, lookupOriginalLanguage } from './lookup.ts';

const KEY = '0123456789abcdef0123456789abcdef';
const ctxWith = (responses: ScriptedResponse[]) =>
  fakePluginContext({ settings: { credential: KEY }, responses });
const file = { path: '/data/movies/The Matrix (1999)/The.Matrix.1999.1080p.mkv' };
const base = { ids: 'unknown', title: 'unknown', file, kind: 'auto' as const };
const movie = (id: number, title: string, language: string, date: string) => ({
  id,
  title,
  original_title: title,
  original_language: language,
  release_date: date,
});
const show = (id: number, name: string, language: string, date: string) => ({
  id,
  name,
  original_name: name,
  original_language: language,
  first_air_date: date,
});
const paths = (ctx: ReturnType<typeof ctxWith>) => ctx.calls.map((c) => new URL(c.url).pathname);

describe('fold', () => {
  it('folds case, punctuation and diacritics', () => {
    expect(fold('S.H.I.E.L.D.')).toBe('s h i e l d');
    expect(fold('Amélie')).toBe(fold('amelie'));
    expect(fold('Tigger & Pooh')).toBe(fold('Tigger and Pooh'));
  });
});

describe('lookupOriginalLanguage by id', () => {
  it('uses the TMDB id; a bare id asks for both kinds', async () => {
    const ctx = ctxWith([
      { match: { url: /\/3\/movie\/603\?/ }, body: readFixture('tmdb/movie-603.json') },
      { match: { url: /\/3\/tv\/603\?/ }, status: 404 },
    ]);
    await expect(lookupOriginalLanguage(ctx, { ...base, ids: { tmdbId: 603 } })).resolves.toEqual({
      language: 'eng',
      reason: 'by TMDB id 603',
    });
    expect(paths(ctx)).toEqual(['/3/movie/603', '/3/tv/603']);
  });

  it('is unknown when id 603 is a movie and a show with different languages', async () => {
    const ctx = ctxWith([
      { match: { url: /\/3\/movie\/603\?/ }, body: readFixture('tmdb/movie-603.json') },
      { match: { url: /\/3\/tv\/603\?/ }, body: { id: 603, original_language: 'ja' } },
    ]);
    const r = await lookupOriginalLanguage(ctx, { ...base, ids: { tmdbId: 603 } });
    expect(r.language).toBe('unknown');
    expect(r.reason).toContain('ambiguous: TMDB id 603 is both a movie and a show');
  });

  it('accepts a colliding id when both kinds agree', async () => {
    const ctx = ctxWith([
      { match: { url: /\/3\/movie\/603\?/ }, body: readFixture('tmdb/movie-603.json') },
      { match: { url: /\/3\/tv\/603\?/ }, body: { id: 603, original_language: 'en' } },
    ]);
    const r = await lookupOriginalLanguage(ctx, { ...base, ids: { tmdbId: 603 } });
    expect(r.language).toBe('eng');
  });

  it('treats the tmdb id as a show when a tvdb id is present', async () => {
    const ctx = ctxWith([
      { match: { url: /\/3\/tv\/1399\?/ }, body: readFixture('tmdb/tv-1399.json') },
    ]);
    const r = await lookupOriginalLanguage(ctx, { ...base, ids: { tmdbId: 1399, tvdbId: 121361 } });
    expect(r.language).toBe('eng');
    expect(paths(ctx)).toEqual(['/3/tv/1399']);
  });

  it('asks only for the fixed kind', async () => {
    const ctx = ctxWith([
      { match: { url: /\/3\/tv\/1399\?/ }, body: readFixture('tmdb/tv-1399.json') },
    ]);
    await lookupOriginalLanguage(ctx, { ...base, kind: 'tv', ids: { tmdbId: '1399' } });
    expect(paths(ctx)).toEqual(['/3/tv/1399']);
  });

  it('finds by IMDb id', async () => {
    const ctx = ctxWith([
      {
        match: { url: /\/3\/find\/tt0133093\?.*external_source=imdb_id/ },
        body: readFixture('tmdb/find-imdb.json'),
      },
    ]);
    await expect(
      lookupOriginalLanguage(ctx, { ...base, ids: { imdbId: 'tt0133093' } }),
    ).resolves.toEqual({
      language: 'eng',
      reason: 'by IMDb id',
    });
  });

  it('is unknown when an IMDb id returns a movie and a show that disagree', async () => {
    const ctx = ctxWith([
      {
        match: { url: /\/3\/find\/tt1\?/ },
        body: {
          movie_results: [{ id: 1, original_language: 'fr' }],
          tv_results: [{ id: 2, original_language: 'de' }],
        },
      },
    ]);
    const r = await lookupOriginalLanguage(ctx, { ...base, ids: { imdbId: 'tt1' } });
    expect(r.language).toBe('unknown');
  });

  it('finds by TVDB id, tv results only', async () => {
    const ctx = ctxWith([
      {
        match: { url: /\/3\/find\/121361\?.*external_source=tvdb_id/ },
        body: { movie_results: [], tv_results: [{ id: 1399, original_language: 'ja' }] },
      },
    ]);
    await expect(
      lookupOriginalLanguage(ctx, { ...base, ids: { tvdbId: 121361 } }),
    ).resolves.toEqual({
      language: 'jpn',
      reason: 'by TVDB id',
    });
  });

  it('moves on to the next id when one finds nothing', async () => {
    const ctx = ctxWith([
      { match: { url: /\/3\/movie\/5\?/ }, status: 404 },
      { match: { url: /\/3\/tv\/5\?/ }, status: 404 },
      {
        match: { url: /\/3\/find\/tt1\?/ },
        body: { movie_results: [{ id: 9, original_language: 'fr' }], tv_results: [] },
      },
    ]);
    const r = await lookupOriginalLanguage(ctx, { ...base, ids: { tmdbId: 5, imdbId: 'tt1' } });
    expect(r).toEqual({ language: 'fra', reason: 'by IMDb id' });
  });

  it('skips malformed ids without a request', async () => {
    const ctx = ctxWith([]);
    const ids = { tmdbId: '12abc', imdbId: '../x', tvdbId: -4 };
    const r = await lookupOriginalLanguage(ctx, {
      ...base,
      ids,
      title: 'Zzz (2001)',
      kind: 'movie',
    });
    // Only the title search was attempted (and failed: nothing scripted).
    expect(paths(ctx)).toEqual(['/3/search/movie']);
    expect(r.language).toBe('unknown');
  });
});

describe('lookupOriginalLanguage by title', () => {
  it('takes the single exact hit and normalises to 639-2/T', async () => {
    const ctx = ctxWith([
      {
        match: { url: /\/3\/search\/movie\?(?=.*query=Heat)(?=.*year=1995)/ },
        body: { results: [movie(1, 'Heat', 'fr', '1995-12-15')] },
      },
    ]);
    const r = await lookupOriginalLanguage(ctx, { ...base, title: 'Heat (1995)', kind: 'movie' });
    expect(r).toEqual({ language: 'fra', reason: 'by title search "Heat" (1995)' });
  });

  it('uses the one-hit fixture', async () => {
    const ctx = ctxWith([
      { match: { url: /\/3\/search\/movie\?/ }, body: readFixture('tmdb/search-movie-one.json') },
    ]);
    const r = await lookupOriginalLanguage(ctx, { ...base, kind: 'movie' });
    expect(r).toEqual({ language: 'eng', reason: 'by title search "The Matrix" (1999)' });
  });

  it('matches the original title and ignores case, punctuation and diacritics', async () => {
    const ctx = ctxWith([
      {
        match: { url: /\/3\/search\/movie\?/ },
        body: {
          results: [
            {
              ...movie(1, 'The Fabulous Destiny', 'fr', '2001-04-25'),
              original_title: 'Le Fabuleux Destin d’Amélie Poulain',
            },
          ],
        },
      },
    ]);
    const r = await lookupOriginalLanguage(ctx, {
      ...base,
      title: 'le fabuleux destin d amelie poulain (2001)',
      kind: 'movie',
    });
    expect(r.language).toBe('fra');
  });

  it('is unknown for a fuzzy single hit with a different title', async () => {
    const ctx = ctxWith([
      {
        match: { url: /\/3\/search\/movie\?/ },
        body: { results: [movie(1, 'Heat Wave', 'en', '1995-01-01')] },
      },
    ]);
    const r = await lookupOriginalLanguage(ctx, { ...base, title: 'Heat (1995)', kind: 'movie' });
    expect(r).toEqual({ language: 'unknown', reason: 'no TMDB match for "Heat" (1995)' });
  });

  it('does not turn "Dark.Web.2019.mkv" into "Dark"', async () => {
    const ctx = ctxWith([
      {
        match: { url: /\/3\/search\/movie\?(?=.*query=Dark\+Web)/ },
        body: { results: [movie(1, 'Dark', 'de', '2019-01-01')] },
      },
    ]);
    const r = await lookupOriginalLanguage(ctx, {
      ...base,
      file: { path: '/data/movies/Dark.Web.2019.mkv' },
    });
    expect(r).toEqual({ language: 'unknown', reason: 'no TMDB match for "Dark Web" (2019)' });
  });

  it('takes a title input as written (S.H.I.E.L.D., Blade Runner 2049)', async () => {
    const a = ctxWith([
      {
        match: { url: /\/3\/search\/(?:movie|tv)\?(?=.*query=S\.H\.I\.E\.L\.D\.)/ },
        body: { results: [] },
      },
      { match: { url: /\/3\/search\/tv\?/ }, body: { results: [] } },
    ]);
    const r = await lookupOriginalLanguage(a, { ...base, title: 'S.H.I.E.L.D.' });
    expect(r.reason).toBe('no TMDB match for "S.H.I.E.L.D."');
    const b = ctxWith([
      {
        match: { url: /\/3\/search\/movie\?(?=.*query=Blade\+Runner\+2049)(?!.*year=)/ },
        body: { results: [movie(1, 'Blade Runner 2049', 'en', '2017-10-04')] },
      },
      { match: { url: /\/3\/search\/tv\?/ }, body: { results: [] } },
    ]);
    const r2 = await lookupOriginalLanguage(b, { ...base, title: 'Blade Runner 2049' });
    expect(r2).toEqual({ language: 'eng', reason: 'by title search "Blade Runner 2049"' });
  });

  it('parses the file name when no title is given, and searches tv with first_air_date_year', async () => {
    const ctx = ctxWith([
      {
        match: {
          url: /\/3\/search\/tv\?(?=.*query=Game\+of\+Thrones)(?=.*first_air_date_year=2011)/,
        },
        body: readFixture('tmdb/search-tv-one.json'),
      },
    ]);
    const r = await lookupOriginalLanguage(ctx, {
      ...base,
      file: { path: '/data/shows/Game of Thrones (2011)/Season 01/S01E01.mkv' },
    });
    expect(r).toEqual({ language: 'eng', reason: 'by title search "Game of Thrones" (2011)' });
    expect(paths(ctx)).toEqual(['/3/search/tv']);
  });

  it('is ambiguous when two hits match exactly', async () => {
    const ctx = ctxWith([
      { match: { url: /\/3\/search\/movie\?/ }, body: readFixture('tmdb/search-movie-many.json') },
    ]);
    const r = await lookupOriginalLanguage(ctx, { ...base, title: 'Example', kind: 'movie' });
    expect(r).toEqual({ language: 'unknown', reason: 'ambiguous: 2 TMDB matches for "Example"' });
  });

  it('keeps only exact hits of the wanted year', async () => {
    const ctx = ctxWith([
      { match: { url: /\/3\/search\/movie\?/ }, body: readFixture('tmdb/search-movie-many.json') },
    ]);
    const r = await lookupOriginalLanguage(ctx, {
      ...base,
      title: 'Example (2005)',
      kind: 'movie',
    });
    expect(r).toEqual({ language: 'eng', reason: 'by title search "Example" (2005)' });
  });

  it('reports no match', async () => {
    const ctx = ctxWith([
      { match: { url: /\/3\/search\/movie\?/ }, body: readFixture('tmdb/search-movie-none.json') },
    ]);
    const r = await lookupOriginalLanguage(ctx, {
      ...base,
      title: 'Nothing Here (2001)',
      kind: 'movie',
    });
    expect(r).toEqual({ language: 'unknown', reason: 'no TMDB match for "Nothing Here" (2001)' });
  });

  it('searches both kinds for a title input and counts exact hits across them', async () => {
    const ctx = ctxWith([
      {
        match: { url: /\/3\/search\/movie\?/ },
        body: { results: [movie(1, 'Name Only', 'en', '2000-01-01')] },
      },
      {
        match: { url: /\/3\/search\/tv\?/ },
        body: { results: [show(2, 'Name Only', 'en', '2001-01-01')] },
      },
    ]);
    const r = await lookupOriginalLanguage(ctx, { ...base, title: 'Name Only' });
    expect(r.reason).toBe('ambiguous: 2 TMDB matches for "Name Only"');
  });

  it('never falls back to movies for a name with an episode marker', async () => {
    const ctx = ctxWith([{ match: { url: /\/3\/search\/tv\?/ }, body: { results: [] } }]);
    const r = await lookupOriginalLanguage(ctx, {
      ...base,
      file: { path: '/data/shows/Takeover/Season 02/Takeover.S02E04.Switch.720p.mkv' },
    });
    expect(r.language).toBe('unknown');
    expect(paths(ctx)).toEqual(['/3/search/tv']);
  });

  it('never falls back to tv for a year-only name', async () => {
    const ctx = ctxWith([{ match: { url: /\/3\/search\/movie\?/ }, body: { results: [] } }]);
    await lookupOriginalLanguage(ctx, {
      ...base,
      file: { path: '/data/movies/Drift.2019.1080p.mkv' },
    });
    expect(paths(ctx)).toEqual(['/3/search/movie']);
  });

  it('uses the movie folder when the file name has no year', async () => {
    const ctx = ctxWith([
      {
        match: { url: /\/3\/search\/movie\?(?=.*query=Drift)(?=.*year=2019)/ },
        body: { results: [movie(1, 'Drift', 'en', '2019-01-01')] },
      },
    ]);
    const r = await lookupOriginalLanguage(ctx, {
      ...base,
      file: { path: '/data/movies/Drift (2019)/video.mkv' },
    });
    expect(r.reason).toBe('by title search "Drift" (2019)');
  });

  it('turns xx and a missing language into unknown', async () => {
    for (const language of ['xx', undefined]) {
      const hit = { ...movie(1, 'Silent', 'xx', '2000-01-01') };
      if (language === undefined) delete (hit as Partial<typeof hit>).original_language;
      const ctx = ctxWith([{ match: { url: /\/3\/search\/movie\?/ }, body: { results: [hit] } }]);
      const r = await lookupOriginalLanguage(ctx, {
        ...base,
        title: 'Silent (2000)',
        kind: 'movie',
      });
      expect(r.language).toBe('unknown');
      expect(r.reason).toContain('no original language');
    }
  });

  it("maps TMDB's cn to Cantonese", async () => {
    const ctx = ctxWith([
      {
        match: { url: /\/3\/search\/movie\?/ },
        body: { results: [movie(1, 'Kung', 'cn', '2000-01-01')] },
      },
    ]);
    const r = await lookupOriginalLanguage(ctx, { ...base, title: 'Kung (2000)', kind: 'movie' });
    expect(r.language).toBe('yue');
  });
});

describe('lookupOriginalLanguage failures and cache', () => {
  const idCtx = () =>
    ctxWith([
      { match: { url: /\/3\/movie\/603\?/ }, body: readFixture('tmdb/movie-603.json') },
      { match: { url: /\/3\/tv\/603\?/ }, status: 404 },
    ]);

  it('caches a found answer', async () => {
    const ctx = idCtx();
    const input = { ...base, ids: { tmdbId: 603 } };
    const first = await lookupOriginalLanguage(ctx, input);
    const second = await lookupOriginalLanguage(ctx, input);
    expect(ctx.calls).toHaveLength(2);
    expect(second.language).toBe(first.language);
  });

  it('caches "no match" and "ambiguous" answers', async () => {
    const ctx = ctxWith([{ match: { url: /\/3\/search\/movie\?/ }, body: { results: [] } }]);
    const input = { ...base, title: 'Late (2000)', kind: 'movie' as const };
    const first = await lookupOriginalLanguage(ctx, input);
    const second = await lookupOriginalLanguage(ctx, input);
    expect(first.reason).toBe('no TMDB match for "Late" (2000)');
    expect(second.language).toBe('unknown');
    expect(second.reason).toContain('no TMDB match');
    expect(ctx.calls).toHaveLength(1);
  });

  it('expires the negative answer after an hour', async () => {
    const ctx = ctxWith([
      { match: { url: /\/3\/search\/movie\?/ }, body: { results: [] } },
      {
        match: { url: /\/3\/search\/movie\?/ },
        body: { results: [movie(1, 'Late', 'en', '2000-01-01')] },
      },
    ]);
    const sets: number[] = [];
    const set = ctx.cache.set.bind(ctx.cache);
    ctx.cache.set = async (k, v, ttl) => {
      sets.push(ttl);
      return set(k, v, ttl);
    };
    await lookupOriginalLanguage(ctx, { ...base, title: 'Late (2000)', kind: 'movie' });
    expect(sets).toEqual([3_600_000]);
  });

  it('does not cache service problems', async () => {
    const ctx = ctxWith([
      { match: { url: /\/3\/movie\/1\?/ }, status: 429 },
      { match: { url: /\/3\/movie\/1\?/ }, body: { id: 1, original_language: 'en' } },
      { match: { url: /\/3\/tv\/1\?/ }, status: 404 },
    ]);
    const input = { ...base, ids: { tmdbId: 1 } };
    expect((await lookupOriginalLanguage(ctx, input)).language).toBe('unknown');
    expect((await lookupOriginalLanguage(ctx, input)).language).toBe('eng');
  });

  it('turns a rate limit into unknown', async () => {
    const ctx = ctxWith([{ match: { url: /\/3\/movie\/1\?/ }, status: 429 }]);
    const r = await lookupOriginalLanguage(ctx, { ...base, ids: { tmdbId: 1 } });
    expect(r).toEqual({ language: 'unknown', reason: 'TMDB rate limit hit; try again later' });
  });

  it('classifies fetch errors by kind, not by class (the host has its own SDK copy)', async () => {
    class HostFetchError extends Error {
      constructor(readonly kind: string) {
        super('host error');
      }
    }
    const through = async (kind: string) => {
      const ctx = {
        ...ctxWith([]),
        async fetch(): Promise<never> {
          throw new HostFetchError(kind);
        },
      };
      return lookupOriginalLanguage(ctx, { ...base, ids: { tmdbId: 1 } });
    };
    expect((await through('timeout')).reason).toBe('TMDB unreachable: timeout');
    expect((await through('refused')).reason).toBe('TMDB unreachable: refused');
    expect((await through('rate-limited')).reason).toBe('TMDB rate limit hit; try again later');
  });

  it('rethrows an error that is not a fetch failure', async () => {
    const ctx = {
      ...ctxWith([]),
      async fetch(): Promise<never> {
        throw new TypeError('bug');
      },
    };
    await expect(lookupOriginalLanguage(ctx, { ...base, ids: { tmdbId: 1 } })).rejects.toThrow(
      'bug',
    );
  });

  it('turns an unscripted fetch into unreachable: failed', async () => {
    const r = await lookupOriginalLanguage(ctxWith([]), { ...base, ids: { tmdbId: 1 } });
    expect(r.reason).toBe('TMDB unreachable: failed');
  });

  it('reports a rejected credential and other HTTP errors', async () => {
    const a = await lookupOriginalLanguage(
      ctxWith([{ match: { url: /\/3\/movie\/1\?/ }, status: 401 }]),
      { ...base, ids: { tmdbId: 1 } },
    );
    expect(a.reason).toBe('TMDB rejected the credential');
    const b = await lookupOriginalLanguage(
      ctxWith([{ match: { url: /\/3\/movie\/1\?/ }, status: 503 }]),
      { ...base, ids: { tmdbId: 1 } },
    );
    expect(b.reason).toBe('TMDB answered HTTP 503');
  });

  it('says so when the file name has nothing usable', async () => {
    const r = await lookupOriginalLanguage(ctxWith([]), {
      ...base,
      file: { path: '/data/movies/.mkv' },
    });
    expect(r.language).toBe('unknown');
    expect(r.reason).toContain('no title');
  });
});
