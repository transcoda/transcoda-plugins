import { coalesceReset } from '@transcoda/plugin-arr-common';
import { fakeHookContext, runData, runFinishRun, runTest } from '@transcoda/sdk/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import plugin from './index.ts';
import { integration } from './integration.ts';
import { originalLanguage } from './original-language.ts';
import { rescan } from './rescan.ts';
import { BASE, ctxWith, fixture, movies, runContext, SENTINEL } from './test-support.ts';

const FILE = '/data/movies/Example Movie (2019)/Example Movie (2019).mkv';
const MOVIE_URL = `${BASE}/api/v3/movie`;
const FILE_URL = `${BASE}/api/v3/moviefile?movieId=11`;

beforeEach(() => coalesceReset());

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
    expect(call.auth).toEqual({ header: { name: 'X-Api-Key', value: SENTINEL } });
  }
}

const happy = () => [
  { match: { url: `${BASE}/api/v3/system/status` }, body: fixture('radarr-status') },
  {
    match: { url: `${BASE}/api/v3/config/mediamanagement` },
    body: { autoUnmonitorPreviouslyDownloadedMovies: true },
  },
  { match: { url: MOVIE_URL }, body: movies() },
  { match: { url: FILE_URL }, body: [{ id: 501, movieId: 11, path: FILE }] },
  { match: { url: `${BASE}/api/v3/command`, method: 'POST' }, body: { id: 4242 } },
  { match: { url: `${BASE}/api/v3/command/4242` }, body: fixture('command-completed') },
  { match: { url: FILE_URL }, body: [{ id: 501, movieId: 11, path: FILE }] },
];

describe('secret hygiene', () => {
  it('test(), the data node and the rescan keep the key in auth only', async () => {
    const ctx = ctxWith(happy());
    const out = [
      await runTest(integration, ctx),
      await runData(originalLanguage, fakeHookContext({ plugin: ctx }), {}),
      await runFinishRun(rescan, runContext(ctx), {}),
    ];
    assertClean(ctx, out);
  });

  it('error paths do not leak the key either', async () => {
    const fail = (status: number) =>
      ctxWith([
        { match: { url: /.*/ }, status },
        { match: { url: /.*/ }, status },
        { match: { url: /.*/ }, status },
      ]);
    for (const status of [401, 500]) {
      const ctx = fail(status);
      const out = [
        await runTest(integration, ctx),
        await runData(originalLanguage, fakeHookContext({ plugin: ctx }), {}),
        await runFinishRun(rescan, runContext(ctx), {}),
      ];
      assertClean(ctx, out);
    }
  });

  it('an unscripted (unreachable) Radarr does not leak the key', async () => {
    const ctx = ctxWith([]);
    const out = [
      await runTest(integration, ctx),
      await runData(originalLanguage, fakeHookContext({ plugin: ctx }), {}),
      await runFinishRun(rescan, runContext(ctx), {}),
    ];
    assertClean(ctx, out);
  });

  it('a service that echoes nothing but fails mid-rescan does not leak the key', async () => {
    const ctx = ctxWith([
      { match: { url: MOVIE_URL }, body: movies() },
      { match: { url: FILE_URL }, body: [{ id: 501, movieId: 11, path: FILE }] },
      { match: { url: `${BASE}/api/v3/command`, method: 'POST' }, body: { id: 4242 } },
      { match: { url: `${BASE}/api/v3/command/4242` }, body: fixture('command-failed') },
    ]);
    assertClean(ctx, [await runFinishRun(rescan, runContext(ctx), {})]);
  });

  it('the plugin has no hooks', () => {
    expect(plugin.hooks).toBeUndefined();
  });
});
