import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { coalesceReset } from '@transcoda/plugin-arr-common';
import { fakeHookContext, runFinish, runFinishRun } from '@transcoda/sdk/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rescan } from './rescan.ts';
import { BASE, ctxWith, fixture, movies, type Responses, runContext } from './test-support.ts';

const MOVIE_URL = `${BASE}/api/v3/movie`;
const FILE_URL = `${BASE}/api/v3/moviefile?movieId=11`;
const CMD_URL = `${BASE}/api/v3/command`;
const POLL_URL = `${BASE}/api/v3/command/4242`;
const ROOT_URL = `${BASE}/api/v3/rootfolder`;
const FILE = '/data/movies/Example Movie (2019)/Example Movie (2019).mkv';

const queued = fixture('command-queued');
const completed = fixture('command-completed');
const failed = fixture('command-failed');
const listing = (path: string) => [{ id: 501, movieId: 11, path }];

beforeEach(() => coalesceReset());
afterEach(() => vi.useRealTimers());

const happy = (): NonNullable<Responses> => [
  { match: { url: MOVIE_URL }, body: movies() },
  { match: { url: FILE_URL }, body: listing(FILE) },
  { match: { url: CMD_URL, method: 'POST' }, body: { id: 4242, status: 'queued' } },
  { match: { url: POLL_URL }, body: completed },
  { match: { url: FILE_URL }, body: listing(FILE) },
];

describe('radarr:rescan finish', () => {
  it('returns exactly the required plugin action', async () => {
    const res = await runFinish(rescan, { ...fakeHookContext(), model: undefined as never }, {});
    expect(res).toEqual({
      actions: [
        {
          kind: 'plugin',
          description: 'rescan the movie in Radarr and verify the file is listed',
          required: true,
        },
      ],
      reason: 'rescan after the write',
    });
    expect(rescan.finishPhase).toBe('library-manager');
    expect(rescan.kind).toBe('finish');
  });
});

describe('radarr:rescan run', () => {
  it('rescans the movie and reports the file as listed', async () => {
    const ctx = ctxWith(happy());
    const res = await runFinishRun(rescan, runContext(ctx), {});
    expect(res).toEqual({ ok: true, message: `Radarr lists ${FILE} (Example Movie (2019))` });
    const post = ctx.calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ name: 'RescanMovie', movieId: 11 });
    expect(post?.timeoutMs).toBe(10_000);
  });

  it('polls a queued command until it completes', async () => {
    vi.useFakeTimers();
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: movies() },
      { match: { url: FILE_URL }, body: listing(FILE) },
      { match: { url: CMD_URL, method: 'POST' }, body: { id: 4242, status: 'queued' } },
      { match: { url: POLL_URL }, body: queued },
      { match: { url: POLL_URL }, body: completed },
      { match: { url: FILE_URL }, body: listing(FILE) },
    ]);
    const p = runFinishRun(rescan, runContext(ctx), {});
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ ok: true, message: `Radarr lists ${FILE} (Example Movie (2019))` });
    expect(ctx.calls.filter((c) => c.url === POLL_URL)).toHaveLength(2);
  });

  it('verifies the new path when the container changed', async () => {
    const newPath = '/data/movies/Example Movie (2019)/Example Movie (2019).mp4';
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: movies() },
      { match: { url: FILE_URL }, body: listing(FILE) },
      { match: { url: CMD_URL, method: 'POST' }, body: { id: 4242, status: 'queued' } },
      { match: { url: POLL_URL }, body: completed },
      { match: { url: FILE_URL }, body: listing(newPath) },
    ]);
    const res = await runFinishRun(rescan, runContext(ctx, { newPath }), {});
    expect(res).toEqual({ ok: true, message: `Radarr lists ${newPath} (Example Movie (2019))` });
  });

  it('accepts a trailing slash difference in the listed path', async () => {
    const responses = happy();
    responses[4] = { match: { url: FILE_URL }, body: listing(`${FILE}/`) };
    const res = await runFinishRun(rescan, runContext(ctxWith(responses)), {});
    expect(res.ok).toBe(true);
  });

  it('is loud when Radarr lists the file under a different case (never a false "listed")', async () => {
    const responses = happy();
    responses[4] = {
      match: { url: FILE_URL },
      body: listing('/data/movies/example movie (2019)/Example Movie (2019).mkv'),
    };
    const res = await runFinishRun(rescan, runContext(ctxWith(responses)), {});
    expect(res).toEqual({
      ok: false,
      message: `Radarr does not list ${FILE} after rescan; Example Movie (2019) may show as missing`,
    });
  });

  it('is loud when the file is not listed at all after the rescan', async () => {
    const responses = happy();
    responses[4] = { match: { url: FILE_URL }, body: [] };
    const res = await runFinishRun(rescan, runContext(ctxWith(responses)), {});
    expect(res.ok).toBe(false);
    expect(res.message).toContain('may show as missing');
  });

  it('applies the path mapping to the messages and the comparison', async () => {
    const ctx = ctxWith(happy(), { mappings: [{ remote: '/data/movies', local: '/movies' }] });
    const local = '/movies/Example Movie (2019)/Example Movie (2019).mkv';
    const res = await runFinishRun(
      rescan,
      runContext(ctx, { originalPath: local, newPath: local }),
      {},
    );
    expect(res).toEqual({ ok: true, message: `Radarr lists ${FILE} (Example Movie (2019))` });
  });

  it('does nothing when Radarr does not know the file', async () => {
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: movies() },
      { match: { url: FILE_URL }, body: [] },
      { match: { url: ROOT_URL }, body: [{ path: '/data/movies' }] },
    ]);
    const res = await runFinishRun(rescan, runContext(ctx), {});
    expect(res).toEqual({
      ok: false,
      message: `Radarr does not know ${FILE}; nothing was rescanned`,
    });
    expect(ctx.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('does nothing when no movie matches the path, and points at a missing path mapping', async () => {
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: movies() },
      { match: { url: ROOT_URL }, body: [{ path: '/data/movies/' }, { path: '/data/4k' }] },
    ]);
    const local = '/media/movies/Example Movie (2019)/Example Movie (2019).mkv';
    const res = await runFinishRun(rescan, runContext(ctx, { originalPath: local }), {});
    expect(res.message).toBe(
      `Radarr does not know ${local}, which is outside its root folders (/data/movies/, /data/4k): add a path mapping in the Radarr settings; nothing was rescanned`,
    );
    expect(ctx.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('without readable root folders, the message still names the path', async () => {
    const ctx = ctxWith([{ match: { url: MOVIE_URL }, body: movies() }]);
    const res = await runFinishRun(rescan, runContext(ctx, { originalPath: '/x/y.mkv' }), {});
    expect(res.message).toBe('Radarr does not know /x/y.mkv; nothing was rescanned');
  });

  it('a failed command is not retryable', async () => {
    const responses = happy();
    responses.splice(3, 2, { match: { url: POLL_URL }, body: failed });
    const res = await runFinishRun(rescan, runContext(ctxWith(responses)), {});
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(
      /^Radarr rescan of Example Movie \(2019\) failed: command RescanMovie ended failed/,
    );
    expect('retryable' in res && res.retryable).toBeFalsy();
  });

  it('a command that is not accepted fails the step', async () => {
    const responses = happy();
    responses.splice(2, 3, { match: { url: CMD_URL, method: 'POST' }, body: {} });
    const res = await runFinishRun(rescan, runContext(ctxWith(responses)), {});
    expect(res).toEqual({
      ok: false,
      message: 'Radarr rescan of Example Movie (2019) failed: command RescanMovie was not accepted',
    });
  });

  it('a rescan that does not finish in time is retryable', async () => {
    vi.useFakeTimers();
    const responses = [
      { match: { url: MOVIE_URL }, body: movies() },
      { match: { url: FILE_URL }, body: listing(FILE) },
      { match: { url: CMD_URL, method: 'POST' }, body: { id: 4242, status: 'queued' } },
      ...Array.from({ length: 40 }, () => ({ match: { url: POLL_URL }, body: queued })),
    ];
    const p = runFinishRun(rescan, runContext(ctxWith(responses)), { timeoutSeconds: 30 });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(await p).toEqual({
      ok: false,
      retryable: true,
      message: 'Radarr rescan of Example Movie (2019) did not finish within 30 s',
    });
  });

  it('turns a connection failure into an unreachable result', async () => {
    const res = await runFinishRun(rescan, runContext(ctxWith([])), {});
    expect(res).toEqual({ ok: false, retryable: true, message: 'Radarr unreachable: failed' });
  });

  it('a refused fetch is not retryable', async () => {
    const ctx = ctxWith([]);
    ctx.fetch = async () => {
      throw Object.assign(new Error('refused'), { kind: 'refused' });
    };
    const res = await runFinishRun(rescan, runContext(ctx), {});
    expect(res).toEqual({ ok: false, retryable: false, message: 'Radarr unreachable: refused' });
  });

  it('turns an error answer into a readable failure', async () => {
    const ctx = ctxWith([{ match: { url: MOVIE_URL }, status: 401 }]);
    const res = await runFinishRun(rescan, runContext(ctx), {});
    expect(res.ok).toBe(false);
    expect(res.message).toContain('401');
  });

  it('two files of one movie inside the window give exactly one rescan POST', async () => {
    vi.useFakeTimers();
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: movies() },
      { match: { url: FILE_URL }, body: listing(FILE) },
      { match: { url: FILE_URL }, body: listing(FILE) },
      { match: { url: CMD_URL, method: 'POST' }, body: { id: 4242, status: 'queued' } },
      { match: { url: POLL_URL }, body: queued },
      { match: { url: POLL_URL }, body: completed },
      { match: { url: FILE_URL }, body: listing(FILE) },
      { match: { url: FILE_URL }, body: listing(FILE) },
    ]);
    const a = runFinishRun(rescan, runContext(ctx), {});
    // The first rescan is still polling (sleeping) when the second file's step starts.
    await vi.advanceTimersByTimeAsync(500);
    expect(ctx.calls.filter((c) => c.url === POLL_URL)).toHaveLength(1);
    const b = runFinishRun(rescan, runContext(ctx), {});
    await vi.advanceTimersByTimeAsync(5000);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    expect(ctx.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('forbidden commands', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const sources = readdirSync(dir).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'test-support.ts',
  );

  it('no source file names a command that could import or refresh', () => {
    expect(sources).toContain('rescan.ts');
    for (const f of sources) {
      const text = readFileSync(`${dir}${f}`, 'utf8');
      for (const bad of ['DownloadedMoviesScan', 'ManualImport', 'RefreshMovie']) {
        expect(text, `${f} mentions ${bad}`).not.toContain(bad);
      }
    }
  });

  it('every RescanMovie body in the sources carries movieId', () => {
    const text = readFileSync(`${dir}rescan.ts`, 'utf8');
    const bodies = text.match(/name:\s*'RescanMovie'[^}]*}/g) ?? [];
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).toContain('movieId');
  });
});
