import { readdirSync, readFileSync } from 'node:fs';
import { coalesceReset } from '@transcoda/plugin-arr-common';
import {
  fakeHookContext,
  fakePluginContext,
  runFinish,
  runFinishRun,
} from '@transcoda/sdk/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rescan } from './rescan.ts';
import {
  arrFixture,
  epFile,
  episode,
  get,
  post,
  runCtx,
  SHOW,
  SHOW2,
  settings,
} from './test-util.ts';

const queued = arrFixture('command-queued') as Record<string, unknown>;
const cmd = (status: string, extra: Record<string, unknown> = {}) =>
  get('/api/v3/command/4242', { ...queued, status, ...extra });
const POST_CMD = post('/api/v3/command', queued);

const ORIG = '/data/shows/Show/S01E03.mkv';
const lookup = (path = ORIG) => [
  get('/api/v3/series', [SHOW, SHOW2]),
  get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, path)]),
  get('/api/v3/episode?seriesId=1&episodeFileId=5', [episode(1, 1, 5, 3)]),
];

beforeEach(() => {
  coalesceReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

async function settle<T>(p: Promise<T>, ms = 10_000): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return p;
}

describe('sonarr:rescan finish', () => {
  it('returns exactly the required plugin action', async () => {
    const r = await runFinish(rescan, fakeHookContext() as never, {});
    expect(r).toEqual({
      actions: [
        {
          kind: 'plugin',
          description: 'rescan the series in Sonarr and verify the file is listed',
          required: true,
        },
      ],
      reason: 'rescan after the write',
    });
  });
});

describe('sonarr:rescan run', () => {
  it('rescans and confirms the new path is listed', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        ...lookup(),
        POST_CMD,
        cmd('queued'),
        cmd('completed'),
        get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, ORIG)]),
      ],
    });
    const r = await settle(runFinishRun(rescan, runCtx(ctx), {}));
    expect(r).toEqual({ ok: true, message: `Sonarr lists ${ORIG} (S01E03)` });
    const posts = ctx.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ name: 'RescanSeries', seriesId: 1 });
    // the API key travels only in structured auth
    expect(posts[0]?.auth).toEqual({ header: { name: 'X-Api-Key', value: 'key-1' } });
  });

  it('verifies the new path (container change) and not the old one', async () => {
    const NEW = '/data/shows/Show/S01E03.mp4';
    const ctx = fakePluginContext({
      settings,
      responses: [
        ...lookup(),
        POST_CMD,
        cmd('completed'),
        get('/api/v3/episodefile?seriesId=1', [epFile(6, 1, NEW)]),
      ],
    });
    const r = await settle(runFinishRun(rescan, runCtx(ctx, { newPath: NEW }), {}));
    expect(r).toEqual({ ok: true, message: `Sonarr lists ${NEW} (S01E03)` });
  });

  it('compares through path mappings and trims trailing slashes', async () => {
    const ctx = fakePluginContext({
      settings,
      mappings: [{ remote: '/tv/', local: '/data/shows' }],
      responses: [
        get('/api/v3/series', [{ ...SHOW, path: '/tv/Show/' }]),
        get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, '/tv/Show/S01E03.mkv')]),
        get('/api/v3/episode?seriesId=1&episodeFileId=5', [episode(1, 1, 5, 3)]),
        POST_CMD,
        cmd('completed'),
        get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, '/tv/Show/S01E03.mkv/')]),
      ],
    });
    const r = await settle(runFinishRun(rescan, runCtx(ctx), {}));
    expect(r).toEqual({ ok: true, message: 'Sonarr lists /tv/Show/S01E03.mkv (S01E03)' });
  });

  it('is loud when Sonarr lists the file under a different casing', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        ...lookup(),
        POST_CMD,
        cmd('completed'),
        get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, '/data/shows/show/S01E03.mkv')]),
      ],
    });
    const r = await settle(runFinishRun(rescan, runCtx(ctx), {}));
    expect(r).toEqual({
      ok: false,
      message: `Sonarr does not list ${ORIG} after rescan; episode S01E03 may show as missing`,
    });
  });

  it('is loud when the series is not listed at all after the rescan', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        ...lookup(),
        POST_CMD,
        cmd('completed'),
        get('/api/v3/episodefile?seriesId=1', []),
      ],
    });
    const r = await settle(runFinishRun(rescan, runCtx(ctx), {}));
    expect(r.ok).toBe(false);
  });

  it('does nothing when Sonarr does not know the file', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [get('/api/v3/series', [SHOW]), get('/api/v3/episodefile?seriesId=1', [])],
    });
    const r = await settle(runFinishRun(rescan, runCtx(ctx), {}));
    expect(r).toEqual({
      ok: false,
      message: `Sonarr does not know ${ORIG}; nothing was rescanned`,
    });
    expect(ctx.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('does nothing when no series covers the path', async () => {
    const ctx = fakePluginContext({ settings, responses: [get('/api/v3/series', [SHOW2])] });
    const r = await settle(runFinishRun(rescan, runCtx(ctx), {}));
    expect(r).toMatchObject({ ok: false });
    expect(ctx.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('does not match a sibling series by string prefix (Review Focus 1)', async () => {
    const path = '/data/shows/Show 2/S01E01.mkv';
    const ctx = fakePluginContext({
      settings,
      responses: [
        get('/api/v3/series', [SHOW, SHOW2]),
        get('/api/v3/episodefile?seriesId=2', [epFile(9, 2, path)]),
        get('/api/v3/episode?seriesId=2&episodeFileId=9', [episode(1, 2, 9, 1)]),
        POST_CMD,
        cmd('completed'),
        get('/api/v3/episodefile?seriesId=2', [epFile(9, 2, path)]),
      ],
    });
    const r = await settle(
      runFinishRun(rescan, runCtx(ctx, { originalPath: path, newPath: path }), {}),
    );
    expect(r.ok).toBe(true);
    expect(ctx.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'RescanSeries',
      seriesId: 2,
    });
  });

  it('reports a failed command as non-retryable', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [...lookup(), POST_CMD, cmd('failed', { exception: 'Boom' })],
    });
    const r = await settle(runFinishRun(rescan, runCtx(ctx), {}));
    expect(r).toEqual({
      ok: false,
      message: 'Sonarr rescan of Show failed: command RescanSeries ended failed: Boom',
    });
    expect(r).not.toHaveProperty('retryable');
  });

  it('reports a timeout as retryable', async () => {
    const polls = Array.from({ length: 40 }, () => cmd('started'));
    const ctx = fakePluginContext({ settings, responses: [...lookup(), POST_CMD, ...polls] });
    const r = await settle(runFinishRun(rescan, runCtx(ctx), { timeoutSeconds: 30 }), 60_000);
    expect(r).toEqual({
      ok: false,
      retryable: true,
      message: 'Sonarr rescan of Show did not finish within 30 s',
    });
  });

  it('reports an unreachable Sonarr as retryable', async () => {
    const ctx = fakePluginContext({ settings });
    const r = await settle(runFinishRun(rescan, runCtx(ctx), {}));
    expect(r).toEqual({ ok: false, retryable: true, message: 'Sonarr unreachable: failed' });
  });

  it('does not retry a refused connection', async () => {
    const ctx = fakePluginContext({ settings });
    ctx.fetch = async () => {
      throw Object.assign(new Error('nope'), { kind: 'refused' });
    };
    const r = await settle(runFinishRun(rescan, runCtx(ctx), {}));
    expect(r).toEqual({ ok: false, retryable: false, message: 'Sonarr unreachable: refused' });
  });

  it('omits the episode label from messages when it cannot be read', async () => {
    const ok = fakePluginContext({
      settings,
      responses: [
        get('/api/v3/series', [SHOW]),
        get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, ORIG)]),
        get('/api/v3/episode?seriesId=1&episodeFileId=5', null, 500),
        POST_CMD,
        cmd('completed'),
        get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, ORIG)]),
      ],
    });
    expect(await settle(runFinishRun(rescan, runCtx(ok), {}))).toEqual({
      ok: true,
      message: `Sonarr lists ${ORIG}`,
    });
    coalesceReset();
    const bad = fakePluginContext({
      settings,
      responses: [
        get('/api/v3/series', [SHOW]),
        get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, ORIG)]),
        get('/api/v3/episode?seriesId=1&episodeFileId=5', null, 500),
        POST_CMD,
        cmd('completed'),
        get('/api/v3/episodefile?seriesId=1', []),
      ],
    });
    expect(await settle(runFinishRun(rescan, runCtx(bad), {}))).toEqual({
      ok: false,
      message: `Sonarr does not list ${ORIG} after rescan`,
    });
  });

  it('still rescans via the new path when Sonarr already dropped the old file', async () => {
    const NEW = '/data/shows/Show/S01E03.mp4';
    const ctx = fakePluginContext({
      settings,
      responses: [
        get('/api/v3/series', [SHOW]),
        get('/api/v3/episodefile?seriesId=1', []),
        get('/api/v3/episodefile?seriesId=1', []),
        POST_CMD,
        cmd('completed'),
        get('/api/v3/episodefile?seriesId=1', [epFile(6, 1, NEW)]),
      ],
    });
    const r = await settle(runFinishRun(rescan, runCtx(ctx, { newPath: NEW }), {}));
    expect(r).toEqual({ ok: true, message: `Sonarr lists ${NEW}` });
    expect(ctx.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('still says nothing was rescanned when old and new path are the same and unknown', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [get('/api/v3/series', [SHOW]), get('/api/v3/episodefile?seriesId=1', [])],
    });
    const r = await settle(runFinishRun(rescan, runCtx(ctx), {}));
    expect(r.ok).toBe(false);
    expect(ctx.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('treats a command whose status stays unknown as retryable', async () => {
    const ctx = fakePluginContext({ settings, responses: [...lookup(), POST_CMD] });
    const r = await settle(runFinishRun(rescan, runCtx(ctx), { timeoutSeconds: 30 }), 60_000);
    expect(r).toMatchObject({ ok: false, retryable: true });
    expect(r.message).toContain('status unknown');
  });

  it('retries a Sonarr 5xx but not a 4xx', async () => {
    const five = fakePluginContext({ settings, responses: [get('/api/v3/series', null, 503)] });
    const r5 = await settle(runFinishRun(rescan, runCtx(five), {}));
    expect(r5).toMatchObject({ ok: false, retryable: true });
    const four = fakePluginContext({ settings, responses: [get('/api/v3/series', null, 401)] });
    const r4 = await settle(runFinishRun(rescan, runCtx(four), {}));
    expect(r4).toMatchObject({ ok: false, retryable: false });
  });

  it('sends one RescanSeries for two files of one series while the first is still polling', async () => {
    const A = '/data/shows/Show/S01E03.mkv';
    const B = '/data/shows/Show/S01E04.mkv';
    const mk = (path: string, fileId: number, n: number, withCommand: boolean) =>
      fakePluginContext({
        settings,
        responses: [
          get('/api/v3/series', [SHOW]),
          get('/api/v3/episodefile?seriesId=1', [epFile(fileId, 1, path)]),
          get(`/api/v3/episode?seriesId=1&episodeFileId=${fileId}`, [episode(1, 1, fileId, n)]),
          ...(withCommand ? [POST_CMD, cmd('queued'), cmd('started'), cmd('completed')] : []),
          get('/api/v3/episodefile?seriesId=1', [epFile(fileId, 1, path)]),
        ],
      });
    const c1 = mk(A, 5, 3, true);
    const c2 = mk(B, 6, 4, false);
    const p1 = runFinishRun(rescan, runCtx(c1, { originalPath: A, newPath: A }), {});
    const p2 = runFinishRun(rescan, runCtx(c2, { originalPath: B, newPath: B }), {});
    // let both reach the command while the first poll sleeps
    await vi.advanceTimersByTimeAsync(1000);
    expect(c1.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    const [r1, r2] = await settle(Promise.all([p1, p2]));
    expect(r1).toEqual({ ok: true, message: `Sonarr lists ${A} (S01E03)` });
    expect(r2).toEqual({ ok: true, message: `Sonarr lists ${B} (S01E04)` });
    expect(c2.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });
});

describe('sonarr client hygiene', () => {
  it('never uses the commands that import, rename or refresh', () => {
    const dir = new URL('.', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files).toContain('rescan.ts');
    const forbidden = ['DownloadedEpisodesScan', 'ManualImport', 'RefreshSeries'];
    const sources = [
      ...files.map((f) => [f, readFileSync(new URL(f, dir), 'utf8')] as const),
      ...readdirSync(new URL('../../../packages/arr-common/src/', import.meta.url))
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map(
          (f) =>
            [
              `arr-common/${f}`,
              readFileSync(
                new URL(`../../../packages/arr-common/src/${f}`, import.meta.url),
                'utf8',
              ),
            ] as const,
        ),
    ];
    for (const [name, text] of sources) {
      for (const word of forbidden) expect(text, `${name} mentions ${word}`).not.toContain(word);
    }
  });

  it('every RescanSeries body carries seriesId', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        ...lookup(),
        POST_CMD,
        cmd('completed'),
        get('/api/v3/episodefile?seriesId=1', []),
      ],
    });
    await settle(runFinishRun(rescan, runCtx(ctx), {}));
    const bodies = ctx.calls.filter((c) => c.method === 'POST').map((c) => c.body);
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).toMatchObject({ name: 'RescanSeries', seriesId: 1 });
  });
});
