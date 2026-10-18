import { fakePluginContext } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { lookupRequest } from './lookup.ts';
import { BASE, fixture, get, settings } from './test-util.ts';

const ctxOf = (responses: ReturnType<typeof get>[]) => fakePluginContext({ settings, responses });
const urls = (ctx: ReturnType<typeof ctxOf>) => ctx.calls.map((c) => c.url);
const UNKNOWN = { requested: 'unknown', requestedBy: 'unknown', requestedAt: 'unknown' };
const NOT = { requested: false, requestedBy: '', requestedAt: '' };

const movie = fixture('movie-requested') as {
  mediaInfo: { requests: Array<Record<string, unknown>> };
};
const withRequests = (requests: unknown[]) => ({
  ...fixture('movie-requested'),
  mediaInfo: { id: 1, requests },
});
const request = (over: Record<string, unknown>) => ({
  id: 1,
  status: 2,
  createdAt: '2026-09-01T10:00:00.000Z',
  requestedBy: { id: 2, displayName: 'Alex' },
  ...over,
});

describe('lookupRequest by id', () => {
  it('Sonarr ids (tvdb + tmdb) read the tv endpoint by tmdb id', async () => {
    const ctx = ctxOf([get('/api/v1/tv/900100', fixture('tv-requested'))]);
    const r = await lookupRequest(ctx, {
      ids: { tvdbId: 800100, tmdbId: 900100 },
      title: 'unknown',
      kind: 'auto',
    });
    expect(urls(ctx)).toEqual([`${BASE}/api/v1/tv/900100`]);
    expect(r.value).toEqual({
      requested: true,
      requestedBy: 'Alex',
      requestedAt: '2026-09-10T18:00:00.000Z',
    });
    expect(r.reason).toBe('Example Show: requested by Alex on 2026-09-10');
  });

  it('Radarr ids (tmdb only) read the movie endpoint; the earliest live request wins', async () => {
    const ctx = ctxOf([get('/api/v1/movie/900001', fixture('movie-requested'))]);
    const r = await lookupRequest(ctx, { ids: { tmdbId: 900001 }, title: 'unknown', kind: 'auto' });
    expect(urls(ctx)).toEqual([`${BASE}/api/v1/movie/900001`]);
    // the earlier request (id 31) is declined (status 3) and ignored
    expect(r.value).toEqual({
      requested: true,
      requestedBy: 'Alex',
      requestedAt: '2026-09-01T10:00:00.000Z',
    });
    expect(r.reason).toBe('Example Movie: requested by Alex on 2026-09-01');
  });

  it('a fixed kind overrides the guess', async () => {
    const ctx = ctxOf([get('/api/v1/tv/900100', fixture('tv-requested'))]);
    const r = await lookupRequest(ctx, { ids: { tmdbId: 900100 }, title: null, kind: 'tv' });
    expect(urls(ctx)).toEqual([`${BASE}/api/v1/tv/900100`]);
    expect(r.value).toMatchObject({ requested: true });
    const movieCtx = ctxOf([get('/api/v1/movie/5', fixture('movie-unrequested'))]);
    await lookupRequest(movieCtx, { ids: { tvdbId: 1, tmdbId: 5 }, title: null, kind: 'movie' });
    expect(urls(movieCtx)).toEqual([`${BASE}/api/v1/movie/5`]);
  });

  it('only declined requests, or no mediaInfo, means not requested', async () => {
    const declined = ctxOf([get('/api/v1/movie/1', withRequests([request({ status: 3 })]))]);
    expect(
      (await lookupRequest(declined, { ids: { tmdbId: 1 }, title: null, kind: 'auto' })).value,
    ).toEqual(NOT);
    const none = ctxOf([get('/api/v1/movie/900002', fixture('movie-unrequested'))]);
    const r = await lookupRequest(none, { ids: { tmdbId: 900002 }, title: null, kind: 'auto' });
    expect(r.value).toEqual(NOT);
    expect(r.reason).toBe('Example Movie Two: not requested in Seerr');
  });

  it('a title Seerr knows with mediaInfo.requests [] is not requested (S3)', async () => {
    const ctx = ctxOf([get('/api/v1/movie/900002', fixture('movie-known-unrequested'))]);
    const r = await lookupRequest(ctx, { ids: { tmdbId: 900002 }, title: null, kind: 'auto' });
    expect(r.value).toEqual(NOT);
    expect(r.reason).toBe('Example Movie Two: not requested in Seerr');
  });

  it('a request without createdAt gives requestedAt unknown', async () => {
    const ctx = ctxOf([get('/api/v1/movie/1', withRequests([request({ createdAt: undefined })]))]);
    const r = await lookupRequest(ctx, { ids: { tmdbId: 1 }, title: null, kind: 'auto' });
    expect(r.value).toEqual({ requested: true, requestedBy: 'Alex', requestedAt: 'unknown' });
  });

  it('never outputs an email display name (S6); it names the user id instead', async () => {
    const mail = request({ requestedBy: { id: 3, displayName: 'alex@example.invalid' } });
    const ctx = ctxOf([get('/api/v1/movie/1', withRequests([mail]))]);
    const r = await lookupRequest(ctx, { ids: { tmdbId: 1 }, title: null, kind: 'auto' });
    expect(r.value).toMatchObject({ requested: true, requestedBy: 'user #3' });
    expect(JSON.stringify(r)).not.toContain('@');
    const noId = request({ requestedBy: { displayName: 'a@b' } });
    const r2 = await lookupRequest(ctxOf([get('/api/v1/movie/1', withRequests([noId]))]), {
      ids: { tmdbId: 1 },
      title: null,
      kind: 'auto',
    });
    expect(JSON.stringify(r2)).not.toContain('@');
  });

  it('an unknown id (404) is unknown', async () => {
    const ctx = ctxOf([get('/api/v1/movie/9', null, 404)]);
    const r = await lookupRequest(ctx, { ids: { tmdbId: 9 }, title: null, kind: 'auto' });
    expect(r.value).toEqual(UNKNOWN);
    expect(r.reason).toContain('TMDB id 9');
  });

  it('an id TMDB does not know (Seerr answers 500, S3) is unknown with a clear reason', async () => {
    const body = { message: 'Unable to retrieve movie.' };
    const ctx = ctxOf([get('/api/v1/movie/9', body, 500)]);
    const r = await lookupRequest(ctx, { ids: { tmdbId: 9 }, title: null, kind: 'auto' });
    expect(r).toEqual({
      value: UNKNOWN,
      reason: 'Seerr could not load TMDB id 9 (unknown id, or TMDB unreachable)',
    });
    const tv = ctxOf([get('/api/v1/tv/9', { message: 'Unable to retrieve series.' }, 500)]);
    const r2 = await lookupRequest(tv, { ids: { tmdbId: 9 }, title: null, kind: 'tv' });
    expect(r2.value).toEqual(UNKNOWN);
    expect(r2.reason).toContain('could not load TMDB id 9');
  });

  it('other HTTP statuses are unknown with the status in the reason', async () => {
    const ctx = ctxOf([get('/api/v1/movie/9', null, 502)]);
    const r = await lookupRequest(ctx, { ids: { tmdbId: 9 }, title: null, kind: 'auto' });
    expect(r.value).toEqual(UNKNOWN);
    expect(r.reason).toContain('502');
    const auth = ctxOf([get('/api/v1/movie/9', null, 401)]);
    const r2 = await lookupRequest(auth, { ids: { tmdbId: 9 }, title: null, kind: 'auto' });
    expect(r2.reason).toBe('Seerr rejected the API key');
  });

  it('ignores invalid ids', async () => {
    const ctx = ctxOf([]);
    const r = await lookupRequest(ctx, {
      ids: { tmdbId: -4, tvdbId: 0 },
      title: 'unknown',
      kind: 'auto',
    });
    expect(r.value).toEqual(UNKNOWN);
    expect(ctx.calls).toEqual([]);
  });
});

describe('lookupRequest title checks', () => {
  it('tmdb-only ids on auto: a connected title that does not match the fetched one is unknown', async () => {
    const ctx = ctxOf([get('/api/v1/movie/900001', fixture('movie-requested'))]);
    const r = await lookupRequest(ctx, {
      ids: { tmdbId: 900001 },
      title: 'Some Other Show',
      kind: 'auto',
    });
    expect(r.value).toEqual(UNKNOWN);
    expect(r.reason).toContain('Example Movie');
    expect(r.reason).toContain('Some Other Show');
  });

  it('a matching title (any case, with a year) still resolves', async () => {
    const ctx = ctxOf([get('/api/v1/movie/900001', fixture('movie-requested'))]);
    const r = await lookupRequest(ctx, {
      ids: { tmdbId: 900001 },
      title: 'example movie (2001)',
      kind: 'auto',
    });
    expect(r.value).toMatchObject({ requested: true });
  });

  it('the title check does not apply with a tvdbId or a fixed kind', async () => {
    const tv = ctxOf([get('/api/v1/tv/900100', fixture('tv-requested'))]);
    const a = await lookupRequest(tv, {
      ids: { tvdbId: 1, tmdbId: 900100 },
      title: 'Different Name',
      kind: 'auto',
    });
    expect(a.value).toMatchObject({ requested: true });
    const fixed = ctxOf([get('/api/v1/movie/900001', fixture('movie-requested'))]);
    const b = await lookupRequest(fixed, {
      ids: { tmdbId: 900001 },
      title: 'Different Name',
      kind: 'movie',
    });
    expect(b.value).toMatchObject({ requested: true });
  });

  it('a punctuation-only title is no title', async () => {
    const ctx = ctxOf([]);
    for (const title of ['!!!', '...', '—', '(!!!)']) {
      const r = await lookupRequest(ctx, { ids: {}, title, kind: 'auto' });
      expect(r.reason).toBe('connect ids or a title (from Sonarr, Radarr or TMDB)');
    }
    expect(ctx.calls).toEqual([]);
  });

  it('a result whose name is only punctuation never matches', async () => {
    const search = { results: [{ id: 1, mediaType: 'movie', title: '???' }] };
    const ctx = ctxOf([get('/api/v1/search?query=a%3F&page=1', search)]);
    const r = await lookupRequest(ctx, { ids: {}, title: 'a?', kind: 'auto' });
    expect(r.value).toEqual(UNKNOWN);
  });

  it('title-only matches say when no year was given', async () => {
    const search = {
      results: [
        { id: 900001, mediaType: 'movie', title: 'Example Movie', releaseDate: '2001-05-04' },
      ],
    };
    const ctx = ctxOf([
      get('/api/v1/search?query=Example%20Movie&page=1', search),
      get('/api/v1/movie/900001', fixture('movie-requested')),
    ]);
    const r = await lookupRequest(ctx, { ids: {}, title: 'Example Movie', kind: 'auto' });
    expect(r.reason).toContain('no year');
    const two = {
      results: [
        { id: 1, mediaType: 'movie', title: 'Example Movie' },
        { id: 2, mediaType: 'tv', name: 'Example Movie' },
      ],
    };
    const amb = ctxOf([get('/api/v1/search?query=Example%20Movie&page=1', two)]);
    expect(
      (await lookupRequest(amb, { ids: {}, title: 'Example Movie', kind: 'auto' })).reason,
    ).toContain('no year');
  });
});

describe('lookupRequest by title', () => {
  const SEARCH = (q: string) => `/api/v1/search?query=${q}&page=1`;

  it('only a tvdbId plus a title searches by title (S5)', async () => {
    const ctx = ctxOf([
      get(SEARCH('Example%20Show'), fixture('search')),
      get('/api/v1/tv/900100', fixture('tv-requested')),
    ]);
    const r = await lookupRequest(ctx, {
      ids: { tvdbId: 800100 },
      title: 'Example Show',
      kind: 'auto',
    });
    expect(urls(ctx)).toEqual([`${BASE}${SEARCH('Example%20Show')}`, `${BASE}/api/v1/tv/900100`]);
    expect(r.value).toMatchObject({ requested: true, requestedBy: 'Alex' });
  });

  it('a title alone searches both kinds and needs exactly one match', async () => {
    const ctx = ctxOf([
      get(SEARCH('example%20movie'), fixture('search')),
      get('/api/v1/movie/900001', fixture('movie-requested')),
    ]);
    const r = await lookupRequest(ctx, { ids: 'unknown', title: 'example movie', kind: 'auto' });
    expect(r.value).toMatchObject({ requested: true, requestedBy: 'Alex' });
  });

  it('uses the search result mediaInfo when it carries requests', async () => {
    const search = {
      results: [
        {
          id: 900001,
          mediaType: 'movie',
          title: 'Example Movie',
          mediaInfo: { requests: [request({})] },
        },
      ],
    };
    const ctx = ctxOf([get(SEARCH('Example%20Movie'), search)]);
    const r = await lookupRequest(ctx, { ids: {}, title: 'Example Movie', kind: 'auto' });
    expect(r.value).toMatchObject({ requested: true, requestedBy: 'Alex' });
    expect(ctx.calls).toHaveLength(1);
  });

  it('two hits with the same name and no year is unknown', async () => {
    const search = {
      results: [
        { id: 1, mediaType: 'movie', title: 'Example Movie', releaseDate: '2001-01-01' },
        { id: 2, mediaType: 'movie', title: 'Example Movie', releaseDate: '2010-01-01' },
      ],
    };
    const ctx = ctxOf([get(SEARCH('Example%20Movie'), search)]);
    const r = await lookupRequest(ctx, { ids: {}, title: 'Example Movie', kind: 'auto' });
    expect(r.value).toEqual(UNKNOWN);
    expect(r.reason).toContain('Example Movie');
  });

  it('a title with a year filters by release year', async () => {
    const search = {
      results: [
        { id: 1, mediaType: 'movie', title: 'Example Movie', releaseDate: '2001-01-01' },
        { id: 2, mediaType: 'movie', title: 'Example Movie', releaseDate: '2010-01-01' },
      ],
    };
    const ctx = ctxOf([
      get(SEARCH('Example%20Movie'), search),
      get('/api/v1/movie/1', fixture('movie-requested')),
    ]);
    const r = await lookupRequest(ctx, { ids: {}, title: 'Example Movie (2001)', kind: 'auto' });
    expect(r.value).toMatchObject({ requested: true });
    expect(urls(ctx)[0]).toBe(`${BASE}${SEARCH('Example%20Movie')}`);
    expect(urls(ctx)[1]).toBe(`${BASE}/api/v1/movie/1`);
  });

  it('a fixed kind ignores results of the other kind', async () => {
    const search = {
      results: [
        { id: 1, mediaType: 'movie', title: 'Example', releaseDate: '2001-01-01' },
        { id: 2, mediaType: 'tv', name: 'Example', firstAirDate: '2002-01-01' },
      ],
    };
    const both = ctxOf([get(SEARCH('Example'), search)]);
    expect((await lookupRequest(both, { ids: {}, title: 'Example', kind: 'auto' })).value).toEqual(
      UNKNOWN,
    );
    const tv = ctxOf([
      get(SEARCH('Example'), search),
      get('/api/v1/tv/2', fixture('tv-requested')),
    ]);
    expect(
      (await lookupRequest(tv, { ids: {}, title: 'Example', kind: 'tv' })).value,
    ).toMatchObject({ requested: true });
  });

  it("percent-encodes ' ( ) ! * in the query, which Seerr rejects raw (S4)", async () => {
    const search = {
      results: [{ id: 900100, mediaType: 'tv', name: "Example's Show (Redux)!*" }],
    };
    const q = 'Example%27s%20Show%20%28Redux%29%21%2A';
    const ctx = ctxOf([get(SEARCH(q), search), get('/api/v1/tv/900100', fixture('tv-requested'))]);
    const r = await lookupRequest(ctx, {
      ids: { tvdbId: 800100 },
      title: "Example's Show (Redux)!*",
      kind: 'auto',
    });
    const first = urls(ctx)[0] ?? '';
    expect(first).toBe(`${BASE}${SEARCH(q)}`);
    expect(first).toContain('%27');
    expect(first).toContain('%28');
    expect(first).toContain('%29');
    expect(first).not.toMatch(/[!'()*]/);
    expect(r.value).toMatchObject({ requested: true });
  });

  it('retries once with a cleaned title when the search answers 400 (S4)', async () => {
    const search = {
      results: [
        { id: 900002, mediaType: 'movie', title: 'Example: Movie Two!', releaseDate: '2010-03-12' },
      ],
    };
    const ctx = ctxOf([
      get(SEARCH('Example%3A%20Movie%20Two%21'), null, 400),
      get(SEARCH('Example%20Movie%20Two'), search),
      get('/api/v1/movie/900002', fixture('movie-unrequested')),
    ]);
    const r = await lookupRequest(ctx, {
      ids: {},
      title: 'Example: Movie Two!',
      kind: 'auto',
    });
    expect(r.value).toEqual(NOT);
    expect(urls(ctx)).toHaveLength(3);
  });

  it('is unknown when the cleaned retry also answers 400, or there is nothing to clean', async () => {
    const twice = ctxOf([get(SEARCH('A%26B'), null, 400), get(SEARCH('A%20B'), null, 400)]);
    expect((await lookupRequest(twice, { ids: {}, title: 'A&B', kind: 'auto' })).value).toEqual(
      UNKNOWN,
    );
    const plain = ctxOf([get(SEARCH('Plain'), null, 400)]);
    expect((await lookupRequest(plain, { ids: {}, title: 'Plain', kind: 'auto' })).value).toEqual(
      UNKNOWN,
    );
    expect(plain.calls).toHaveLength(1);
  });

  it('no results is unknown', async () => {
    const ctx = ctxOf([get(SEARCH('Nothing'), { results: [] })]);
    const r = await lookupRequest(ctx, { ids: {}, title: 'Nothing', kind: 'auto' });
    expect(r.value).toEqual(UNKNOWN);
  });

  it('a tvdbId alone, without a title, is unknown (S5)', async () => {
    const ctx = ctxOf([]);
    const r = await lookupRequest(ctx, { ids: { tvdbId: 7 }, title: 'unknown', kind: 'auto' });
    expect(r.value).toEqual(UNKNOWN);
    expect(ctx.calls).toEqual([]);
    expect(r.reason).toContain('TVDB');
  });
});

describe('lookupRequest edge cases', () => {
  it('no ids and no title is unknown with a hint', async () => {
    const ctx = ctxOf([]);
    for (const title of ['unknown', '', '   ', null, 5]) {
      const r = await lookupRequest(ctx, { ids: 'unknown', title, kind: 'auto' });
      expect(r).toEqual({
        value: UNKNOWN,
        reason: 'connect ids or a title (from Sonarr, Radarr or TMDB)',
      });
    }
    expect(ctx.calls).toEqual([]);
  });

  it('an unreachable Seerr is unknown, classified by fetchErrorKind', async () => {
    const ctx = fakePluginContext({ settings });
    const r = await lookupRequest(ctx, { ids: { tmdbId: 1 }, title: null, kind: 'auto' });
    expect(r).toEqual({ value: UNKNOWN, reason: 'Seerr unreachable: failed' });
  });

  it('classifies a kind-tagged error from another SDK copy', async () => {
    const ctx = fakePluginContext({ settings });
    ctx.fetch = async () => {
      throw Object.assign(new Error('x'), { kind: 'timeout' });
    };
    const r = await lookupRequest(ctx, { ids: { tmdbId: 1 }, title: null, kind: 'auto' });
    expect(r.reason).toBe('Seerr unreachable: timeout');
  });

  it('rethrows an error that is not a fetch failure', async () => {
    const ctx = fakePluginContext({ settings });
    ctx.fetch = async () => {
      throw new TypeError('bug');
    };
    await expect(
      lookupRequest(ctx, { ids: { tmdbId: 1 }, title: null, kind: 'auto' }),
    ).rejects.toThrow('bug');
  });

  it('sends the key only in auth and keeps a base path in the URL', async () => {
    const ctx = fakePluginContext({
      settings: { url: `${BASE}/seerr/`, apiKey: 'key-1' },
      responses: [
        {
          match: { url: `${BASE}/seerr/api/v1/movie/1`, method: 'GET' },
          body: movie as never,
        },
      ],
    });
    await lookupRequest(ctx, { ids: { tmdbId: 1 }, title: null, kind: 'auto' });
    expect(ctx.calls[0]).toMatchObject({
      auth: { header: { name: 'X-Api-Key', value: 'key-1' } },
      timeoutMs: 10_000,
    });
  });
});
