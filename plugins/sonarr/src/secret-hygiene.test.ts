import { coalesceReset } from '@transcoda/plugin-arr-common';
import {
  fakeHookContext,
  fakePluginContext,
  runData,
  runFinishRun,
  runTest,
} from '@transcoda/sdk/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { integration } from './integration.ts';
import { originalLanguage } from './original-language.ts';
import { rescan } from './rescan.ts';
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
} from './test-util.ts';

const settings = { url: BASE, apiKey: SENTINEL };
const queued = arrFixture('command-queued') as Record<string, unknown>;
const ORIG = '/data/shows/Show/S01E03.mkv';

beforeEach(coalesceReset);

function assertClean(ctx: ReturnType<typeof fakePluginContext>, texts: string[]) {
  for (const [, line] of ctx.logs) expect(line).not.toContain(SENTINEL);
  for (const t of texts) expect(t).not.toContain(SENTINEL);
  expect(ctx.calls.length).toBeGreaterThan(0);
  for (const c of ctx.calls) {
    expect(c.url).not.toContain(SENTINEL);
    expect(JSON.stringify(c.headers ?? {})).not.toContain(SENTINEL);
    expect(JSON.stringify(c.body ?? null)).not.toContain(SENTINEL);
    expect(c.auth).toEqual({ header: { name: 'X-Api-Key', value: SENTINEL } });
  }
}

describe('secret hygiene', () => {
  it('test() carries the key only in auth', async () => {
    const texts: string[] = [];
    for (const responses of [
      [
        get('/api/v3/system/status', arrFixture('sonarr-status')),
        get('/api/v3/config/mediamanagement', arrFixture('sonarr-mediamanagement')),
      ],
      [get('/api/v3/system/status', null, 401)],
      [
        get('/api/v3/system/status', arrFixture('sonarr-status')),
        get('/api/v3/config/mediamanagement', null, 500),
      ],
      [],
    ]) {
      const ctx = fakePluginContext({ settings, responses });
      const r = await runTest(integration, ctx);
      texts.push(JSON.stringify(r));
      assertClean(ctx, texts);
    }
  });

  it('original-language never leaks the key', async () => {
    for (const responses of [
      [get('/api/v3/series', [SHOW])],
      [get('/api/v3/series', null, 500)],
      [],
    ]) {
      const ctx = fakePluginContext({ settings, responses });
      const r = await runData(
        originalLanguage,
        fakeHookContext({
          plugin: ctx,
          file: {
            path: '/data/shows/Show/a.mkv',
            sizeBytes: 1,
            mtime: '2026-10-17T00:00:00.000Z',
            nlink: 1,
          },
        }),
        {},
      );
      assertClean(ctx, [JSON.stringify(r)]);
    }
  });

  it('rescan never leaks the key, on success or any failure', async () => {
    const lookup = [
      get('/api/v3/series', [SHOW]),
      get('/api/v3/episodefile?seriesId=1', [epFile(5, 1, ORIG)]),
      get('/api/v3/episode?seriesId=1&episodeFileId=5', [episode(1, 1, 5, 3)]),
    ];
    const scenarios = [
      [
        ...lookup,
        post('/api/v3/command', queued),
        get('/api/v3/command/4242', { ...queued, status: 'failed', exception: 'X' }),
      ],
      [...lookup, post('/api/v3/command', null)],
      [get('/api/v3/series', null, 401)],
      [],
    ];
    for (const responses of scenarios) {
      coalesceReset();
      const ctx = fakePluginContext({ settings, responses });
      const r = await runFinishRun(rescan, runCtx(ctx), {});
      assertClean(ctx, [JSON.stringify(r)]);
    }
  });
});
