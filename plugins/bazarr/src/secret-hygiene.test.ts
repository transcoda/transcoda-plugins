import { coalesceReset } from '@transcoda/plugin-arr-common';
import { runBuild, runData, runDecide, runFinishRun, runTest } from '@transcoda/sdk/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSubtitlesNow } from './get-subtitles-now.ts';
import { hasSubtitles } from './has-subtitles.ts';
import plugin from './index.ts';
import { integration } from './integration.ts';
import { rescan } from './rescan.ts';
import { subtitlesPresent } from './subtitles-present.ts';
import {
  BASE,
  buildContext,
  ctxWith,
  EPISODE_FILE,
  EPISODE_ONE_URL,
  EPISODE_PATCH_URL,
  EPISODES_URL,
  fixture,
  hookContext,
  MOVIE_FILE,
  MOVIE_ONE_URL,
  MOVIE_PATCH_URL,
  MOVIE_SCAN_URL,
  MOVIES_URL,
  runContext,
  SENTINEL,
  SERIES_SCAN_URL,
  SERIES_URL,
} from './test-util.ts';

beforeEach(() => {
  coalesceReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

type Ctx = ReturnType<typeof ctxWith>;

function assertClean(ctx: Ctx, outputs: unknown[]) {
  expect(ctx.calls.length).toBeGreaterThan(0);
  for (const [, line] of ctx.logs) expect(line).not.toContain(SENTINEL);
  expect(JSON.stringify(outputs)).not.toContain(SENTINEL);
  for (const call of ctx.calls) {
    expect(call.url).not.toContain(SENTINEL);
    expect(JSON.stringify(call.headers ?? {})).not.toContain(SENTINEL);
    expect(JSON.stringify(call.body ?? null)).not.toContain(SENTINEL);
    // Every request authenticates through the structured field.
    expect(call.auth).toEqual({ header: { name: 'X-API-KEY', value: SENTINEL } });
  }
}

/** Every hook and test(), in turn, against one context; thrown messages are collected too. */
async function everything(ctx: Ctx, file: string = EPISODE_FILE): Promise<unknown[]> {
  const out: unknown[] = [];
  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      out.push(await fn());
    } catch (e) {
      out.push(e instanceof Error ? e.message : String(e));
    }
  };
  await attempt(() => runTest(integration, ctx));
  await attempt(() => runData(hasSubtitles, hookContext(ctx, file), {}));
  await attempt(() => runDecide(subtitlesPresent, hookContext(ctx, file), { languages: ['eng'] }));
  const build = runBuild(getSubtitlesNow, buildContext(ctx, file), { languages: ['de'] });
  const settled = build.then(
    (v) => out.push(v),
    (e) => out.push(String(e)),
  );
  await vi.advanceTimersByTimeAsync(60_000);
  await settled;
  await attempt(() =>
    runFinishRun(rescan, runContext(ctx, { originalPath: file, newPath: file }), {}),
  );
  return out;
}

const status = { data: { bazarr_version: 'v1.5.1' } };
const episodes = () => ({ match: { url: EPISODES_URL }, body: fixture('episodes') });
const happy = () => [
  { match: { url: `${BASE}/api/system/status` }, body: status },
  { match: { url: SERIES_URL }, body: fixture('series') },
  episodes(),
  episodes(),
  episodes(),
  { match: { url: EPISODE_PATCH_URL, method: 'PATCH' }, status: 204 },
  { match: { url: EPISODE_ONE_URL }, body: fixture('episodes') },
  { match: { url: SERIES_SCAN_URL, method: 'PATCH' }, status: 204 },
  { match: { url: EPISODE_ONE_URL }, body: fixture('episodes') },
];

describe('secret hygiene', () => {
  it('test(), every node hook and the PATCH calls keep the key in auth only', async () => {
    const ctx = ctxWith(happy());
    assertClean(ctx, await everything(ctx));
    expect(ctx.calls.some((c) => c.method === 'PATCH')).toBe(true);
  });

  it('error paths do not leak the key either', async () => {
    for (const status of [401, 403, 500]) {
      const ctx = ctxWith(Array.from({ length: 40 }, () => ({ match: { url: /.*/ }, status })));
      assertClean(ctx, await everything(ctx));
    }
  });

  it('an unscripted (unreachable) Bazarr does not leak the key', async () => {
    const ctx = ctxWith([]);
    assertClean(ctx, await everything(ctx));
  });

  it('a movie keeps the key in auth only too', async () => {
    const ctx = ctxWith([
      { match: { url: `${BASE}/api/system/status` }, body: status },
      { match: { url: SERIES_URL }, body: { data: [], total: 0 } },
      { match: { url: SERIES_URL }, body: { data: [], total: 0 } },
      { match: { url: MOVIES_URL }, body: fixture('movies') },
      // every lookup re-reads the movie by id
      ...Array.from({ length: 30 }, () => ({
        match: { url: MOVIE_ONE_URL },
        body: fixture('movies-one'),
      })),
      { match: { url: MOVIE_PATCH_URL, method: 'PATCH' }, status: 204 },
      { match: { url: MOVIE_SCAN_URL, method: 'PATCH' }, status: 204 },
    ]);
    const out = await everything(ctx, MOVIE_FILE);
    assertClean(ctx, out);
    expect(ctx.calls.filter((c) => c.method === 'PATCH').map((c) => c.url)).toEqual([
      MOVIE_PATCH_URL,
      MOVIE_SCAN_URL,
    ]);
  });

  it('the plugin has no hooks', () => {
    expect(plugin.hooks).toBeUndefined();
  });
});
