import { coalesceReset } from '@transcoda/plugin-arr-common';
import { fakeHookContext, runFinish, runFinishRun } from '@transcoda/sdk/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { rescan } from './rescan.ts';
import {
  ctxWith,
  EPISODE_FILE,
  EPISODE_ONE_URL,
  EPISODES_URL,
  fetchFailure,
  fixture,
  MOVIE_FILE,
  MOVIE_ONE_URL,
  MOVIE_SCAN_URL,
  MOVIES_URL,
  type Responses,
  runContext,
  SERIES_SCAN_URL,
  SERIES_URL,
} from './test-util.ts';

beforeEach(() => coalesceReset());

const MP4 = EPISODE_FILE.replace('.mkv', '.mp4');
const list = () => ({ match: { url: SERIES_URL }, body: fixture('series') });
const episodesAt = (path: string) => ({
  data: [{ sonarrSeriesId: 1, sonarrEpisodeId: 11, season: 1, episode: 3, path, subtitles: [] }],
});

/** Bazarr knows the file at `path` before and after the scan. */
const happy = (path = EPISODE_FILE): NonNullable<Responses> => [
  list(),
  { match: { url: EPISODES_URL }, body: episodesAt(path) },
  { match: { url: SERIES_SCAN_URL, method: 'PATCH' }, status: 204 },
  { match: { url: EPISODE_ONE_URL }, body: episodesAt(path) },
];

describe('bazarr:rescan finish', () => {
  it('returns exactly one optional plugin action', async () => {
    const res = await runFinish(rescan, { ...fakeHookContext(), model: undefined as never }, {});
    expect(res).toEqual({
      actions: [
        {
          kind: 'plugin',
          description: 'ask Bazarr to rescan the subtitles of this file',
          required: false,
        },
      ],
      reason: 'Bazarr rescan after the write',
    });
    expect(rescan.kind).toBe('finish');
    expect(rescan.finishPhase).toBe('library-manager');
  });
});

describe('bazarr:rescan run', () => {
  it('rescans the series and reports the file as listed', async () => {
    const ctx = ctxWith(happy());
    const res = await runFinishRun(rescan, runContext(ctx), {});
    expect(res).toEqual({
      ok: true,
      message: `asked Bazarr to rescan Example Show S01E03; it lists ${EPISODE_FILE}`,
    });
    const patch = ctx.calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe(SERIES_SCAN_URL);
  });

  it('rescans a movie with radarrid', async () => {
    const ctx = ctxWith([
      { match: { url: SERIES_URL }, body: { data: [], total: 0 } },
      { match: { url: MOVIES_URL }, body: fixture('movies') },
      { match: { url: MOVIE_ONE_URL }, body: fixture('movies-one') },
      { match: { url: MOVIE_SCAN_URL, method: 'PATCH' }, status: 204 },
      { match: { url: MOVIE_ONE_URL }, body: fixture('movies-one') },
    ]);
    const res = await runFinishRun(
      rescan,
      runContext(ctx, { originalPath: MOVIE_FILE, newPath: MOVIE_FILE }),
      {},
    );
    expect(res).toEqual({
      ok: true,
      message: `asked Bazarr to rescan Example Movie; it lists ${MOVIE_FILE}`,
    });
  });

  it('reports a stale path when the container changed and Bazarr still lists the old file', async () => {
    // the lookup by the new path finds nothing (it then tries movies), so the old path is read again
    const ctx = ctxWith([
      { match: { url: MOVIES_URL }, body: { data: [], total: 0 } },
      { match: { url: EPISODES_URL }, body: episodesAt(EPISODE_FILE) },
      ...happy(EPISODE_FILE),
    ]);
    const res = await runFinishRun(
      rescan,
      runContext(ctx, { newPath: MP4, containerChanged: true }),
      {},
    );
    expect(res).toEqual({
      ok: false,
      message: `asked Bazarr to rescan Example Show S01E03, but it still lists ${EPISODE_FILE}; it updates after its next sync with Sonarr or Radarr`,
    });
    // the original path found it, so the scan was still requested
    expect(ctx.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('finds the item by the new path first', async () => {
    const ctx = ctxWith(happy(MP4));
    const res = await runFinishRun(
      rescan,
      runContext(ctx, { newPath: MP4, containerChanged: true }),
      {},
    );
    expect(res).toEqual({
      ok: true,
      message: `asked Bazarr to rescan Example Show S01E03; it lists ${MP4}`,
    });
  });

  it('does not PATCH when Bazarr knows neither path', async () => {
    const ctx = ctxWith([
      { match: { url: SERIES_URL }, body: { data: [], total: 0 } },
      { match: { url: MOVIES_URL }, body: { data: [], total: 0 } },
    ]);
    const res = await runFinishRun(rescan, runContext(ctx), {});
    expect(res).toEqual({
      ok: false,
      message: `Bazarr does not know ${EPISODE_FILE}; it picks the file up when it next syncs with Sonarr or Radarr`,
    });
    expect(ctx.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('maps paths: the message names the remote path', async () => {
    const ctx = ctxWith(
      [
        { match: { url: SERIES_URL }, body: { data: [], total: 0 } },
        { match: { url: MOVIES_URL }, body: { data: [], total: 0 } },
      ],
      { mappings: [{ remote: '/tv', local: '/data/shows' }] },
    );
    const res = await runFinishRun(rescan, runContext(ctx), {});
    expect(res.message).toContain('Bazarr does not know /tv/Example Show/Season 1/');
  });

  it('sends one PATCH for two runs of one series within 5 s', async () => {
    const ctx = ctxWith([
      // both runs start together, so each may fetch the (not yet cached) lists
      list(),
      list(),
      { match: { url: EPISODES_URL }, body: episodesAt(EPISODE_FILE) },
      { match: { url: EPISODES_URL }, body: episodesAt(EPISODE_FILE) },
      { match: { url: SERIES_SCAN_URL, method: 'PATCH' }, status: 204 },
      { match: { url: EPISODE_ONE_URL }, body: episodesAt(EPISODE_FILE) },
      { match: { url: EPISODE_ONE_URL }, body: episodesAt(EPISODE_FILE) },
    ]);
    const [a, b] = await Promise.all([
      runFinishRun(rescan, runContext(ctx), {}),
      runFinishRun(rescan, runContext(ctx), {}),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(ctx.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('turns a 4xx answer into the refusal message', async () => {
    const ctx = ctxWith([
      list(),
      { match: { url: EPISODES_URL }, body: episodesAt(EPISODE_FILE) },
      { match: { url: SERIES_SCAN_URL, method: 'PATCH' }, status: 400 },
    ]);
    const res = await runFinishRun(rescan, runContext(ctx), {});
    expect(res).toEqual({ ok: false, message: 'Bazarr refused the rescan (400)' });
  });

  it('a 5xx answer is retryable', async () => {
    const ctx = ctxWith([
      list(),
      { match: { url: EPISODES_URL }, body: episodesAt(EPISODE_FILE) },
      { match: { url: SERIES_SCAN_URL, method: 'PATCH' }, status: 503 },
    ]);
    const res = await runFinishRun(rescan, runContext(ctx), {});
    expect(res).toEqual({ ok: false, retryable: true, message: 'Bazarr refused the rescan (503)' });
  });

  it('is retryable when Bazarr is unreachable, except when the connection is refused', async () => {
    const down = await runFinishRun(rescan, runContext(ctxWith([])), {});
    expect(down).toEqual({ ok: false, retryable: true, message: 'Bazarr unreachable: failed' });
    const ctx = ctxWith([]);
    ctx.fetch = async () => {
      throw fetchFailure('refused');
    };
    expect(await runFinishRun(rescan, runContext(ctx), {})).toEqual({
      ok: false,
      retryable: false,
      message: 'Bazarr unreachable: refused',
    });
  });

  it('reports an HTTP error from a lookup by its message', async () => {
    const ctx = ctxWith([{ match: { url: SERIES_URL }, status: 401 }]);
    const res = await runFinishRun(rescan, runContext(ctx), {});
    expect(res).toEqual({
      ok: false,
      retryable: false,
      message: 'Bazarr answered 401 for /api/series',
    });
  });

  it('says so when Bazarr no longer lists the item after the scan', async () => {
    const ctx = ctxWith([
      list(),
      { match: { url: EPISODES_URL }, body: episodesAt(EPISODE_FILE) },
      { match: { url: SERIES_SCAN_URL, method: 'PATCH' }, status: 204 },
      { match: { url: EPISODE_ONE_URL }, body: { data: [] } },
    ]);
    const res = await runFinishRun(rescan, runContext(ctx), {});
    expect(res.ok).toBe(false);
    expect(res.message).toContain(
      'asked Bazarr to rescan Example Show S01E03, but it no longer lists',
    );
  });
});
