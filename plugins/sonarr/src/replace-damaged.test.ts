import type { ScriptedResponse } from '@transcoda/sdk/testing';
import {
  fakeHookContext,
  fakePluginContext,
  runFinish,
  runFinishRun,
} from '@transcoda/sdk/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replaceDamaged } from './replace-damaged.ts';
import {
  arrFixture,
  BASE,
  epFile,
  episode,
  get,
  post,
  runCtx,
  SENTINEL,
  SHOW,
  SHOW2,
} from './test-util.ts';

const ORIG = '/data/shows/Show/S01E03.mkv';
const HISTORY = '/api/v3/history/series?seriesId=1';
const BLOCKLIST =
  '/api/v3/blocklist?page=1&pageSize=100&sortKey=date&sortDirection=descending&seriesIds=1';
const RELEASE = 'Example.Show.S01E03E04.1080p.WEB-DL-GRP';
const CONFIG = '/api/v3/config/mediamanagement';
const NOW = Date.parse('2026-10-27T12:00:00Z');
const settings = { url: BASE, apiKey: SENTINEL };
const damaged = { outcome: 'damaged' as const, damage: { reason: 'video: cut off at 00:41:10' } };

const del = (path: string, status = 200): ScriptedResponse => ({
  match: { url: BASE + path, method: 'DELETE' },
  status,
  body: null,
});

const happy = (): ScriptedResponse[] => [
  get('/api/v3/series', [SHOW, SHOW2]),
  get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, ORIG)]),
  get('/api/v3/episode?seriesId=1&episodeFileId=5', [
    episode(100, 1, 5, 3),
    episode(101, 1, 5, 4),
    episode(102, 1, 6, 5),
  ]),
  get(HISTORY, arrFixture('history-series')),
  get(BLOCKLIST, arrFixture('blocklist-series')),
  post('/api/v3/history/failed/60', null),
  del('/api/v3/episodefile/5'),
  get(CONFIG, arrFixture('sonarr-mediamanagement')),
  post('/api/v3/command', { id: 4242, status: 'queued' }),
];

/** Sonarr unmonitors deleted episodes: the file's episodes are set monitored before the search. */
const unmonitoring = (): ScriptedResponse[] => {
  const responses = happy();
  responses[7] = get(CONFIG, {
    ...(arrFixture('sonarr-mediamanagement') as object),
    autoUnmonitorPreviouslyDownloadedEpisodes: true,
  });
  responses.splice(8, 0, {
    match: { url: `${BASE}/api/v3/episode/monitor`, method: 'PUT' },
    body: [] as never,
  });
  return responses;
};

const run = (responses: ScriptedResponse[], over = {}) => {
  const ctx = fakePluginContext({ settings, responses });
  const result = runFinishRun(
    replaceDamaged,
    runCtx(ctx, { ...damaged, afterBytes: 10, ...over }),
    {},
  );
  return { ctx, result };
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});
afterEach(() => vi.useRealTimers());

describe('sonarr:replace-damaged finish', () => {
  it('returns exactly the required plugin action and is damagedOnly', async () => {
    const r = await runFinish(replaceDamaged, fakeHookContext() as never, {});
    expect(r).toEqual({
      actions: [
        {
          kind: 'plugin',
          description: 'blocklist the release, delete the file and search in Sonarr',
          required: true,
        },
      ],
      reason: 'replace the damaged file after the walk',
    });
    expect(replaceDamaged.damagedOnly).toBe(true);
    expect(replaceDamaged.finishPhase).toBe('library-manager');
  });
});

describe('sonarr:replace-damaged run', () => {
  it('order: find → guard → mark failed → delete → search; the message lists every step', async () => {
    const { ctx, result } = run(happy());
    expect(await result).toEqual({
      ok: true,
      message: `Sonarr: found Show S01E03E04; marked the grab of "${RELEASE}" failed (blocklisted); deleted ${ORIG}; started a search`,
    });
    expect(ctx.calls.map((c) => [c.method ?? 'GET', c.url.slice(BASE.length)])).toEqual([
      ['GET', '/api/v3/series'],
      ['GET', '/api/v3/episodefile?seriesId=1'],
      ['GET', '/api/v3/episode?seriesId=1&episodeFileId=5'],
      ['GET', HISTORY],
      ['GET', BLOCKLIST],
      ['POST', '/api/v3/history/failed/60'],
      ['DELETE', '/api/v3/episodefile/5'],
      ['GET', CONFIG],
      ['POST', '/api/v3/command'],
    ]);
    expect(ctx.calls.at(-1)?.body).toEqual({ name: 'EpisodeSearch', episodeIds: [100, 101] });
  });

  it('does not mark a newer single-episode grab of one of the file’s episodes', async () => {
    const single = {
      id: 80,
      seriesId: 1,
      episodeId: 101,
      sourceTitle: 'Example.Show.S01E04.2160p.WEB-DL-NEW',
      eventType: 'grabbed',
      date: '2026-10-26T08:00:00Z',
      downloadId: '0000000000000000000000000000000000000080',
    };
    const responses = happy();
    responses[3] = get(HISTORY, [...(arrFixture('history-series') as unknown[]), single]);
    const { ctx, result } = run(responses);
    expect((await result).ok).toBe(true);
    expect(ctx.calls.filter((c) => c.url.includes('history/failed')).map((c) => c.url)).toEqual([
      `${BASE}/api/v3/history/failed/60`,
    ]);
  });

  it('with "unmonitor deleted episodes" on, sets the episodes monitored before the search', async () => {
    const { ctx, result } = run(unmonitoring());
    expect(await result).toEqual({
      ok: true,
      message: `Sonarr: found Show S01E03E04; marked the grab of "${RELEASE}" failed (blocklisted); deleted ${ORIG}; monitored the episodes again; started a search`,
    });
    const put = ctx.calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe(`${BASE}/api/v3/episode/monitor`);
    expect(put?.body).toEqual({ episodeIds: [100, 101], monitored: true });
    expect(ctx.calls.at(-1)?.url).toBe(`${BASE}/api/v3/command`);
  });

  it('a failed re-monitor after the delete → not retryable, says what is left to do', async () => {
    const responses = unmonitoring();
    responses[8] = {
      match: { url: `${BASE}/api/v3/episode/monitor`, method: 'PUT' },
      status: 500,
    };
    const { ctx, result } = run(responses);
    expect(await result).toEqual({
      ok: false,
      message: `Sonarr: found Show S01E03E04; marked the grab of "${RELEASE}" failed (blocklisted); deleted ${ORIG}; monitoring the episodes again failed: Sonarr answered 500 for /api/v3/episode/monitor — monitor it and search in Sonarr`,
    });
    expect(ctx.calls.some((c) => c.url.endsWith('/api/v3/command'))).toBe(false);
  });

  it('a mark within 7 days on one of the episodes → ok "already requested on <date>" and no further call', async () => {
    const recent = [
      ...(arrFixture('history-series') as unknown[]),
      {
        id: 70,
        episodeId: 101,
        eventType: 'downloadFailed',
        date: '2026-10-23T08:00:00Z',
        sourceTitle: RELEASE,
      },
    ];
    const responses = happy();
    responses[3] = get(HISTORY, recent);
    const { ctx, result } = run(responses);
    expect(await result).toEqual({
      ok: true,
      message: 'Sonarr: Show S01E03E04 was already requested on 2026-10-23; nothing was changed',
    });
    expect(ctx.calls).toHaveLength(4);
  });

  it('a blocklist entry within 7 days for one of the episodes stops it too', async () => {
    const responses = happy();
    responses[4] = get(BLOCKLIST, {
      page: 1,
      pageSize: 100,
      totalRecords: 1,
      records: [{ id: 3, seriesId: 1, episodeIds: [100], date: '2026-10-21T12:00:00Z' }],
    });
    const { ctx, result } = run(responses);
    expect(await result).toEqual({
      ok: true,
      message: 'Sonarr: Show S01E03E04 was already requested on 2026-10-21; nothing was changed',
    });
    expect(ctx.calls.some((c) => c.method === 'POST' || c.method === 'DELETE')).toBe(false);
  });

  it('no grab in history → blocklist noted as not possible, delete and search still happen', async () => {
    const responses = happy();
    responses[3] = get(HISTORY, []);
    responses.splice(5, 1);
    const { ctx, result } = run(responses);
    expect(await result).toEqual({
      ok: true,
      message: `Sonarr: found Show S01E03E04; release couldn’t be blocklisted (no grab in history); deleted ${ORIG}; started a search`,
    });
    expect(ctx.calls.some((c) => c.url.includes('history/failed'))).toBe(false);
  });

  it('delete fails with 500 after the blocklist → not retryable, says what is left to do by hand', async () => {
    const responses = happy();
    responses[6] = del('/api/v3/episodefile/5', 500);
    const { ctx, result } = run(responses);
    expect(await result).toEqual({
      ok: false,
      message: `Sonarr: found Show S01E03E04; marked the grab of "${RELEASE}" failed (blocklisted); deleting the file failed: Sonarr answered 500 for /api/v3/episodefile/5 — delete it and search in Sonarr`,
    });
    expect(ctx.calls.some((c) => c.url.endsWith('/api/v3/command'))).toBe(false);
  });

  it('a failed episode lookup stops before any change', async () => {
    const responses = happy();
    responses[2] = get('/api/v3/episode?seriesId=1&episodeFileId=5', null, 500);
    const { ctx, result } = run(responses);
    expect(await result).toEqual({
      ok: false,
      retryable: true,
      message:
        'find failed: Sonarr answered 500 for /api/v3/episode?seriesId=1&episodeFileId=5; done: nothing',
    });
    expect(ctx.calls).toHaveLength(3);
  });

  it('does nothing when Sonarr does not know the file', async () => {
    const { ctx, result } = run([
      get('/api/v3/series', [SHOW, SHOW2]),
      get('/api/v3/episodefile?seriesId=1', []),
      get('/api/v3/rootfolder', [{ path: '/data/shows' }]),
    ]);
    expect(await result).toEqual({
      ok: false,
      message: `Sonarr does not know ${ORIG}; nothing was changed`,
    });
    expect(ctx.calls).toHaveLength(3);
  });

  it('outcome replaced → refused without any call', async () => {
    const { ctx, result } = run(happy(), { outcome: 'replaced', damage: null });
    expect(await result).toEqual({
      ok: false,
      message: 'Replace damaged file only runs after a damaged source',
    });
    expect(ctx.calls).toHaveLength(0);
  });

  it('the API key never appears in any message', async () => {
    const failing = happy().map((r, i) => (i === 5 ? { ...r, status: 401 } : r));
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
