import { fakeHookContext, runFinish, runFinishRun } from '@transcoda/sdk/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replaceDamaged } from './replace-damaged.ts';
import {
  BASE,
  ctxWith,
  fixture,
  movies,
  type Responses,
  runContext,
  SENTINEL,
} from './test-support.ts';

const FILE = '/data/movies/Example Movie (2019)/Example Movie (2019).mkv';
const MOVIE_URL = `${BASE}/api/v3/movie`;
const FILE_URL = `${BASE}/api/v3/moviefile?movieId=11`;
const HISTORY_URL = `${BASE}/api/v3/history/movie?movieId=11`;
const BLOCKLIST_URL = `${BASE}/api/v3/blocklist?page=1&pageSize=100&sortKey=date&sortDirection=descending&movieIds=11`;
const FAILED_URL = `${BASE}/api/v3/history/failed/42`;
const DELETE_URL = `${BASE}/api/v3/moviefile/501`;
const CMD_URL = `${BASE}/api/v3/command`;
const RELEASE = 'Example.Movie.2019.1080p.WEB-DL-GRP';
const NOW = Date.parse('2026-10-27T12:00:00Z');

const damaged = {
  outcome: 'damaged' as const,
  damage: { reason: 'audio #1 (DTS): decode errors' },
};
const listing = [{ id: 501, movieId: 11, path: FILE }];
const emptyBlocklist = { page: 1, pageSize: 100, totalRecords: 0, records: [] };

const happy = (): NonNullable<Responses> => [
  { match: { url: MOVIE_URL }, body: movies() },
  { match: { url: FILE_URL }, body: listing },
  { match: { url: HISTORY_URL }, body: fixture('history-movie') },
  { match: { url: BLOCKLIST_URL }, body: fixture('blocklist-movie') },
  { match: { url: FAILED_URL, method: 'POST' }, body: null },
  { match: { url: DELETE_URL, method: 'DELETE' }, body: null },
  { match: { url: CMD_URL, method: 'POST' }, body: { id: 4242, status: 'queued' } },
];

const run = (responses: NonNullable<Responses>, over = {}) => {
  const ctx = ctxWith(responses);
  const result = runFinishRun(
    replaceDamaged,
    runContext(ctx, { ...damaged, afterBytes: 10, ...over }),
    {},
  );
  return { ctx, result };
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});
afterEach(() => vi.useRealTimers());

describe('radarr:replace-damaged finish', () => {
  it('returns exactly the required plugin action and is damagedOnly', async () => {
    const res = await runFinish(
      replaceDamaged,
      { ...fakeHookContext(), model: undefined as never },
      {},
    );
    expect(res).toEqual({
      actions: [
        {
          kind: 'plugin',
          description: 'blocklist the release, delete the file and search in Radarr',
          required: true,
        },
      ],
      reason: 'replace the damaged file after the walk',
    });
    expect(replaceDamaged.damagedOnly).toBe(true);
    expect(replaceDamaged.finishPhase).toBe('library-manager');
    expect(replaceDamaged.kind).toBe('finish');
  });
});

describe('radarr:replace-damaged run', () => {
  it('order: find → guard → mark failed → delete → search; the message lists every step', async () => {
    const { ctx, result } = run(happy());
    expect(await result).toEqual({
      ok: true,
      message: `Radarr: found Example Movie (2019); marked the grab of "${RELEASE}" failed (blocklisted); deleted ${FILE}; started a search`,
    });
    expect(ctx.calls.map((c) => [c.method ?? 'GET', c.url])).toEqual([
      ['GET', MOVIE_URL],
      ['GET', FILE_URL],
      ['GET', HISTORY_URL],
      ['GET', BLOCKLIST_URL],
      ['POST', FAILED_URL],
      ['DELETE', DELETE_URL],
      ['POST', CMD_URL],
    ]);
    expect(ctx.calls.at(-1)?.body).toEqual({ name: 'MoviesSearch', movieIds: [11] });
  });

  it('a mark within 7 days → ok "already requested on <date>" and no further call', async () => {
    const recent = [
      ...(fixture('history-movie') as unknown[]),
      {
        id: 44,
        movieId: 11,
        eventType: 'downloadFailed',
        date: '2026-10-22T08:00:00Z',
        sourceTitle: RELEASE,
      },
    ];
    const responses = happy();
    responses[2] = { match: { url: HISTORY_URL }, body: recent as never };
    const { ctx, result } = run(responses);
    expect(await result).toEqual({
      ok: true,
      message:
        'Radarr: Example Movie (2019) was already requested on 2026-10-22; nothing was changed',
    });
    expect(ctx.calls).toHaveLength(3);
  });

  it('a blocklist entry within 7 days stops it too', async () => {
    const responses = happy();
    responses[3] = {
      match: { url: BLOCKLIST_URL },
      body: {
        ...emptyBlocklist,
        totalRecords: 1,
        records: [{ id: 8, movieId: 11, sourceTitle: RELEASE, date: '2026-10-26T23:00:00Z' }],
      },
    };
    const { ctx, result } = run(responses);
    expect(await result).toEqual({
      ok: true,
      message:
        'Radarr: Example Movie (2019) was already requested on 2026-10-26; nothing was changed',
    });
    expect(ctx.calls.some((c) => c.method === 'POST' || c.method === 'DELETE')).toBe(false);
  });

  it('no grab in history → blocklist noted as not possible, delete and search still happen', async () => {
    const responses = happy();
    responses[2] = { match: { url: HISTORY_URL }, body: [] };
    responses.splice(4, 1);
    const { ctx, result } = run(responses);
    expect(await result).toEqual({
      ok: true,
      message: `Radarr: found Example Movie (2019); release couldn’t be blocklisted (no grab in history); deleted ${FILE}; started a search`,
    });
    expect(ctx.calls.some((c) => c.url.includes('history/failed'))).toBe(false);
  });

  it('delete fails with 500 → ok:false, retryable, message names the failed step and the steps done', async () => {
    const responses = happy();
    responses[5] = { match: { url: DELETE_URL, method: 'DELETE' }, status: 500 };
    const { ctx, result } = run(responses);
    expect(await result).toEqual({
      ok: false,
      retryable: true,
      message: `delete failed: Radarr answered 500 for /api/v3/moviefile/501; done: found Example Movie (2019); marked the grab of "${RELEASE}" failed (blocklisted)`,
    });
    expect(ctx.calls.filter((c) => c.url === CMD_URL)).toHaveLength(0);
  });

  it('a search that is not accepted fails the last step', async () => {
    const responses = happy();
    responses[6] = { match: { url: CMD_URL, method: 'POST' }, body: {} };
    const res = await run(responses).result;
    expect(res).toEqual({
      ok: false,
      message: `search failed: command MoviesSearch was not accepted; done: found Example Movie (2019); marked the grab of "${RELEASE}" failed (blocklisted); deleted ${FILE}`,
    });
  });

  it('an unreachable Radarr at the start → nothing done', async () => {
    const res = await run([]).result;
    expect(res).toEqual({
      ok: false,
      retryable: true,
      message: 'find failed: Radarr unreachable: failed; done: nothing',
    });
  });

  it('does nothing when Radarr does not know the file', async () => {
    const { ctx, result } = run([
      { match: { url: MOVIE_URL }, body: movies() },
      { match: { url: FILE_URL }, body: [] },
    ]);
    expect(await result).toEqual({
      ok: false,
      message: 'Radarr does not know this file; nothing was changed',
    });
    expect(ctx.calls).toHaveLength(2);
  });

  it('outcome replaced → refused without any call', async () => {
    for (const outcome of ['replaced', 'kept'] as const) {
      const { ctx, result } = run(happy(), { outcome, damage: null });
      expect(await result).toEqual({
        ok: false,
        message: 'Replace damaged file only runs after a damaged source',
      });
      expect(ctx.calls).toHaveLength(0);
    }
  });

  it('the API key never appears in any message', async () => {
    const failing = happy().map((r, i) => (i === 4 ? { ...r, status: 401 } : r));
    for (const responses of [happy(), failing, []]) {
      const { ctx, result } = run(responses);
      const res = await result;
      expect(JSON.stringify(res)).not.toContain(SENTINEL);
      for (const [, line] of ctx.logs) expect(line).not.toContain(SENTINEL);
      for (const c of ctx.calls) {
        expect(c.url).not.toContain(SENTINEL);
        expect(JSON.stringify(c.body ?? null)).not.toContain(SENTINEL);
        expect(c.auth).toEqual({ header: { name: 'X-Api-Key', value: SENTINEL } });
      }
    }
  });
});
