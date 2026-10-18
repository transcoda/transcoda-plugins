import type { JsonValue } from '@transcoda/plugin-arr-common';
import { runBuild } from '@transcoda/sdk/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSubtitlesNow } from './get-subtitles-now.ts';
import {
  buildContext,
  ctxWith,
  EPISODE_FILE,
  EPISODE_ONE_URL,
  EPISODE_PATCH_URL,
  EPISODES_URL,
  fetchFailure,
  fixture,
  MODEL,
  MOVIE_FILE,
  MOVIE_ONE_URL,
  MOVIE_PATCH_URL,
  MOVIES_URL,
  type Responses,
  SERIES_URL,
} from './test-util.ts';

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-18T12:00:00Z') }));
afterEach(() => vi.useRealTimers());

const START = Date.parse('2026-10-18T12:00:00Z');
const lookup = (): NonNullable<Responses> => [
  { match: { url: SERIES_URL }, body: fixture('series') },
  { match: { url: EPISODES_URL }, body: fixture('episodes') },
];

/** The episodes fixture, with episode 11 listing the given extra subtitle rows. */
function episodesWith(extra: JsonValue[]): JsonValue {
  const raw = fixture('episodes') as { data: Array<{ subtitles: JsonValue[] }> };
  const data = raw.data.map((e, i) =>
    i === 1 ? { ...e, subtitles: [...e.subtitles, ...extra] } : e,
  );
  return { data };
}
const deFile = {
  code2: 'de',
  code3: 'deu',
  path: '/data/shows/Example Show/Season 1/Example Show - S01E03.de.srt',
  forced: false,
  hi: false,
};
const frFile = { ...deFile, code2: 'fr', code3: 'fra', path: '/x/fr.srt' };

/** Records `[method, url, time]` of every fetch and answers `url` from `always` without consuming it. */
function spy(ctx: ReturnType<typeof ctxWith>, always: Record<string, () => JsonValue> = {}) {
  const log: Array<[string, string, number]> = [];
  const inner = ctx.fetch;
  ctx.fetch = async (input) => {
    log.push([input.method ?? 'GET', input.url, Date.now() - START]);
    const body = always[input.url];
    if (body !== undefined) return { status: 200, headers: {}, body: body() };
    return inner(input);
  };
  return log;
}

async function run(ctx: ReturnType<typeof ctxWith>, settings: unknown, file = EPISODE_FILE) {
  const p = runBuild(getSubtitlesNow, buildContext(ctx, file), settings);
  await vi.advanceTimersByTimeAsync(60_000);
  return p;
}

describe('bazarr:get-subtitles-now', () => {
  it('declares its ports and defaults', () => {
    expect(getSubtitlesNow.kind).toBe('action');
    expect(getSubtitlesNow.settings.parse({ languages: ['en'] })).toEqual({
      languages: ['en'],
      forced: false,
      hi: false,
      waitSeconds: 25,
      kind: 'auto',
    });
    expect(getSubtitlesNow.settings.safeParse({ languages: ['eng'] }).success).toBe(false);
    expect(getSubtitlesNow.settings.safeParse({ languages: ['en'], waitSeconds: 4 }).success).toBe(
      false,
    );
    expect(getSubtitlesNow.settings.safeParse({ languages: ['en'], waitSeconds: 26 }).success).toBe(
      false,
    );
  });

  it('dry run: no PATCH, no call at all, the model is returned untouched', async () => {
    const ctx = ctxWith([], { dryRun: true });
    const res = await run(ctx, { languages: ['en', 'de'] });
    expect(res.reason).toBe('dry run: would ask Bazarr for en, de');
    expect(res.model).toBe(MODEL);
    expect(ctx.calls.filter((c) => c.method === 'PATCH')).toEqual([]);
  });

  it('does nothing when Bazarr already lists the language as a file', async () => {
    const ctx = ctxWith(lookup());
    const res = await run(ctx, { languages: ['en'] });
    expect(res.reason).toBe('Bazarr already has en');
    expect(res.model).toBe(MODEL);
    expect(ctx.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('asks Bazarr for the missing language (queued: 204 at once) and polls until it is listed', async () => {
    const ctx = ctxWith([
      ...lookup(),
      { match: { url: EPISODE_PATCH_URL, method: 'PATCH' }, status: 204 },
      { match: { url: EPISODE_ONE_URL }, body: episodesWith([]) },
      { match: { url: EPISODE_ONE_URL }, body: episodesWith([]) },
      { match: { url: EPISODE_ONE_URL }, body: episodesWith([deFile]) },
    ]);
    const log = spy(ctx);
    const res = await run(ctx, { languages: ['en', 'de'] });
    expect(res.reason).toBe('Bazarr downloaded de');
    expect(res.model).toBe(MODEL);
    expect(res.model).toEqual(MODEL);
    const patches = log.filter(([m]) => m === 'PATCH');
    expect(patches).toEqual([['PATCH', EPISODE_PATCH_URL, 0]]);
    // one look right after the PATCH, then every 3 s
    expect(log.filter(([, u]) => u === EPISODE_ONE_URL).map(([, , t]) => t)).toEqual([
      0, 3000, 6000,
    ]);
    expect(ctx.calls.find((c) => c.method === 'PATCH')?.timeoutMs).toBe(25_000);
  });

  it('gives up at the deadline: no call after it, the model stays the same', async () => {
    const ctx = ctxWith(lookup().concat([{ match: { url: EPISODE_PATCH_URL }, status: 204 }]));
    const log = spy(ctx, { [EPISODE_ONE_URL]: () => episodesWith([]) });
    const res = await run(ctx, { languages: ['de'] });
    expect(res.reason).toBe('Bazarr found no de subtitle within 25 s; continuing without');
    expect(res.model).toBe(MODEL);
    expect(Math.max(...log.map(([, , t]) => t))).toBeLessThanOrEqual(25_000);
    expect(log.filter(([m]) => m === 'PATCH')).toHaveLength(1);
  });

  it('still polls when the PATCH times out', async () => {
    const ctx = ctxWith([
      ...lookup(),
      { match: { url: EPISODE_ONE_URL }, body: episodesWith([deFile]) },
    ]);
    const inner = ctx.fetch;
    ctx.fetch = async (input) => {
      if (input.method === 'PATCH') {
        ctx.calls.push(input);
        throw fetchFailure('timeout');
      }
      return inner(input);
    };
    const res = await run(ctx, { languages: ['de'] });
    expect(res.reason).toBe('Bazarr downloaded de');
  });

  it('still polls when Bazarr answers the PATCH with an error status', async () => {
    const ctx = ctxWith([
      ...lookup(),
      { match: { url: EPISODE_PATCH_URL, method: 'PATCH' }, status: 500 },
      { match: { url: EPISODE_ONE_URL }, body: episodesWith([deFile]) },
    ]);
    const res = await run(ctx, { languages: ['de'] });
    expect(res.reason).toBe('Bazarr downloaded de');
  });

  it('reports downloaded and missing languages together', async () => {
    const fr = EPISODE_PATCH_URL.replace('language=de', 'language=fr');
    const ctx = ctxWith(
      lookup().concat([
        { match: { url: EPISODE_PATCH_URL }, status: 204 },
        { match: { url: fr }, status: 204 },
      ]),
    );
    spy(ctx, { [EPISODE_ONE_URL]: () => episodesWith([deFile]) });
    const res = await run(ctx, { languages: ['de', 'fr'], waitSeconds: 10 });
    expect(res.reason).toBe(
      'Bazarr downloaded de; Bazarr found no fr subtitle within 10 s; continuing without',
    );
    expect(ctx.calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
  });

  it('does not count a file with the wrong forced flag', async () => {
    const forcedEn = EPISODE_PATCH_URL.replace(
      'language=de&forced=False',
      'language=en&forced=True',
    );
    const ctx = ctxWith(lookup().concat([{ match: { url: forcedEn }, status: 204 }]));
    const log = spy(ctx, { [EPISODE_ONE_URL]: () => episodesWith([]) });
    const res = await run(ctx, { languages: ['en'], forced: true });
    expect(log.filter(([m]) => m === 'PATCH')).toEqual([['PATCH', forcedEn, 0]]);
    expect(res.reason).toContain('found no en subtitle');
  });

  it('asks for hearing-impaired subtitles with hi=True', async () => {
    const url = EPISODE_PATCH_URL.replace('language=de', 'language=en').replace(
      'hi=False',
      'hi=True',
    );
    const ctx = ctxWith(
      lookup().concat([
        { match: { url }, status: 204 },
        {
          match: { url: EPISODE_ONE_URL },
          body: episodesWith([{ ...frFile, code2: 'en', code3: 'eng', hi: true }]),
        },
      ]),
    );
    const res = await run(ctx, { languages: ['en'], hi: true });
    expect(res.reason).toBe('Bazarr downloaded en');
  });

  it('movies use radarrid', async () => {
    const withDe = {
      data: [
        {
          radarrId: 7,
          title: 'Example Movie',
          path: MOVIE_FILE,
          subtitles: [{ code2: 'de', code3: 'deu', path: '/x/de.srt', forced: false, hi: false }],
        },
      ],
    };
    const ctx = ctxWith([
      { match: { url: SERIES_URL }, body: fixture('series') },
      { match: { url: MOVIES_URL }, body: fixture('movies') },
      { match: { url: MOVIE_ONE_URL }, body: fixture('movies-one') },
      { match: { url: MOVIE_PATCH_URL, method: 'PATCH' }, status: 204 },
      { match: { url: MOVIE_ONE_URL }, body: withDe },
    ]);
    const res = await run(ctx, { languages: ['de'] }, MOVIE_FILE);
    expect(res.reason).toBe('Bazarr downloaded de');
    expect(res.model).toBe(MODEL);
  });

  it('continues when Bazarr does not know the file', async () => {
    const ctx = ctxWith([
      { match: { url: SERIES_URL }, body: { data: [], total: 0 } },
      { match: { url: MOVIES_URL }, body: { data: [], total: 0 } },
    ]);
    const res = await run(ctx, { languages: ['de'] }, '/data/x/a.mkv');
    expect(res.reason).toBe('Bazarr does not know /data/x/a.mkv; continuing without new subtitles');
    expect(res.model).toBe(MODEL);
  });

  it('continues without throwing when Bazarr is unreachable', async () => {
    const ctx = ctxWith([]);
    const res = await run(ctx, { languages: ['de'] });
    expect(res.reason).toBe('Bazarr unreachable: failed; continuing without new subtitles');
    expect(res.model).toBe(MODEL);
  });

  it('continues without throwing when a poll fails', async () => {
    const ctx = ctxWith([...lookup(), { match: { url: EPISODE_PATCH_URL }, status: 204 }]);
    const res = await run(ctx, { languages: ['de'] });
    expect(res.reason).toBe('Bazarr unreachable: failed; continuing without new subtitles');
    expect(res.model).toBe(MODEL);
  });

  it('continues without throwing on an HTTP error from the lookup', async () => {
    const ctx = ctxWith([{ match: { url: SERIES_URL }, status: 401 }]);
    const res = await run(ctx, { languages: ['de'] });
    expect(res.reason).toBe(
      'Bazarr answered 401 for /api/series; continuing without new subtitles',
    );
    expect(res.model).toBe(MODEL);
  });

  it('looks once right after a slow PATCH that finishes at the deadline', async () => {
    const ctx = ctxWith([
      ...lookup(),
      { match: { url: EPISODE_PATCH_URL, method: 'PATCH' }, status: 204 },
      { match: { url: EPISODE_ONE_URL }, body: episodesWith([deFile]) },
    ]);
    const inner = ctx.fetch;
    ctx.fetch = async (input) => {
      if (input.method === 'PATCH') await new Promise((r) => setTimeout(r, 25_000));
      return inner(input);
    };
    const res = await run(ctx, { languages: ['de'] });
    expect(res.reason).toBe('Bazarr downloaded de');
  });

  it('caps every request at what is left of the wait budget', async () => {
    const ctx = ctxWith(lookup().concat([{ match: { url: EPISODE_PATCH_URL }, status: 204 }]));
    const seen: Array<[string, number | undefined, number]> = [];
    const inner = ctx.fetch;
    ctx.fetch = async (input) => {
      seen.push([input.url, input.timeoutMs, Date.now() - START]);
      if (input.url === EPISODE_ONE_URL)
        return { status: 200, headers: {}, body: episodesWith([]) };
      return inner(input);
    };
    await run(ctx, { languages: ['de'] });
    expect(seen.length).toBeGreaterThan(5);
    for (const [, timeoutMs, at] of seen) {
      expect(timeoutMs).toBeDefined();
      expect(timeoutMs).toBeLessThanOrEqual(Math.max(1000, 25_000 - at));
    }
    // the very first lookup already has the whole budget, not the 30 s setting
    expect(seen[0]?.[1]).toBe(25_000);
  });

  it('sends the PATCHes of several languages at the same time', async () => {
    const fr = EPISODE_PATCH_URL.replace('language=de', 'language=fr');
    const ctx = ctxWith(
      lookup().concat([
        { match: { url: EPISODE_PATCH_URL }, status: 204 },
        { match: { url: fr }, status: 204 },
      ]),
    );
    const inner = ctx.fetch;
    ctx.fetch = async (input) => {
      if (input.method === 'PATCH') await new Promise((r) => setTimeout(r, 5000));
      return inner(input);
    };
    // the spy sits outside the delay, so it logs when each PATCH starts
    const log = spy(ctx, { [EPISODE_ONE_URL]: () => episodesWith([deFile, frFile]) });
    const res = await run(ctx, { languages: ['de', 'fr'] });
    expect(log.filter(([m]) => m === 'PATCH').map(([, , t]) => t)).toEqual([0, 0]);
    expect(res.reason).toBe('Bazarr downloaded de, fr');
  });

  it('rethrows nothing but a timeout from a PATCH: another failure ends the wait', async () => {
    const ctx = ctxWith(lookup());
    const inner = ctx.fetch;
    ctx.fetch = async (input) => {
      if (input.method === 'PATCH') throw fetchFailure('refused');
      return inner(input);
    };
    const res = await run(ctx, { languages: ['de'] });
    expect(res.reason).toBe('Bazarr unreachable: refused; continuing without new subtitles');
  });

  it('does not request a language the video already has as a track', async () => {
    // the fixture lists German as a forced track inside the video
    const ctx = ctxWith(lookup());
    const res = await run(ctx, { languages: ['de'], forced: true });
    expect(ctx.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    expect(res.reason).toBe('Bazarr already has de');
  });
});
