import { FetchRefused, nodeMetadata } from '@transcoda/sdk';
import {
  fakeHookContext,
  fakePluginContext,
  runFinish,
  runFinishRun,
} from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { BASE, settings } from '../test/fixtures.ts';
import { refresh } from './refresh.ts';

const MAPPINGS = [
  { local: '/data/shows', remote: '/shows' },
  { local: '/data/movies', remote: '/movies' },
];
const UPDATED = { match: { url: `${BASE}/Library/Media/Updated`, method: 'POST' } };
const REFRESH = { match: { url: `${BASE}/Library/Refresh`, method: 'POST' } };

function runCtx(
  plugin: ReturnType<typeof fakePluginContext>,
  paths: { originalPath: string; newPath: string },
) {
  return {
    ...fakeHookContext({ plugin }),
    ...paths,
    replacedTo: 'recycle' as const,
    beforeBytes: 10,
    afterBytes: 8,
    outcome: 'replaced' as const,
    containerChanged: false,
    problemsSoFar: [],
    jobUrl: null,
  };
}

describe('jellyfin:refresh', () => {
  it('is a media-server finish node', () => {
    const meta = nodeMetadata(refresh);
    expect(meta.kind).toBe('finish');
    expect(meta.finishPhase).toBe('media-server');
    expect(meta.hooks).toEqual(['finish', 'run']);
  });

  it('finish returns one optional plugin action', async () => {
    const ctx = fakeHookContext();
    const file = await runFinish(refresh, { ...ctx, model: {} as never }, {});
    expect(file.actions).toEqual([
      { kind: 'plugin', description: 'ask Jellyfin to rescan the file', required: false },
    ]);
    const lib = await runFinish(refresh, { ...ctx, model: {} as never }, { scope: 'library' });
    expect(lib.actions).toEqual([
      { kind: 'plugin', description: 'ask Jellyfin to rescan every library', required: false },
    ]);
  });

  it('sends one Modified entry when the path did not change', async () => {
    const plugin = fakePluginContext({
      settings,
      mappings: MAPPINGS,
      responses: [{ ...UPDATED, status: 204 }],
    });
    const p = '/data/shows/Example Show/S01E01.mkv';
    const res = await runFinishRun(refresh, runCtx(plugin, { originalPath: p, newPath: p }), {});
    expect(res).toEqual({
      ok: true,
      message: 'asked Jellyfin to rescan /shows/Example Show/S01E01.mkv',
    });
    expect(plugin.calls[0]?.body).toEqual({
      Updates: [{ Path: '/shows/Example Show/S01E01.mkv', UpdateType: 'Modified' }],
    });
  });

  it('sends Modified and Deleted when the file moved or was renamed', async () => {
    const plugin = fakePluginContext({
      settings,
      mappings: MAPPINGS,
      responses: [{ ...UPDATED, status: 200 }],
    });
    const res = await runFinishRun(
      refresh,
      runCtx(plugin, {
        originalPath: '/data/shows/Example Show/S01E01.avi',
        newPath: '/data/shows/Example Show/S01E01.mkv',
      }),
      {},
    );
    expect(res.ok).toBe(true);
    expect(plugin.calls[0]?.body).toEqual({
      Updates: [
        { Path: '/shows/Example Show/S01E01.mkv', UpdateType: 'Modified' },
        { Path: '/shows/Example Show/S01E01.avi', UpdateType: 'Deleted' },
      ],
    });
  });

  it('answers non-retryable not-ok on a 500', async () => {
    const plugin = fakePluginContext({ settings, responses: [{ ...UPDATED, status: 500 }] });
    const p = '/data/shows/a.mkv';
    const res = await runFinishRun(refresh, runCtx(plugin, { originalPath: p, newPath: p }), {});
    expect(res).toEqual({ ok: false, message: 'Jellyfin answered 500 to the rescan request' });
  });

  it('scans every library with scope library', async () => {
    const plugin = fakePluginContext({ settings, responses: [{ ...REFRESH, status: 204 }] });
    const p = '/data/shows/a.mkv';
    const res = await runFinishRun(refresh, runCtx(plugin, { originalPath: p, newPath: p }), {
      scope: 'library',
    });
    expect(res).toEqual({ ok: true, message: 'asked Jellyfin to rescan every library' });
    expect(plugin.calls).toHaveLength(1);
    expect(plugin.calls[0]?.url).toBe(`${BASE}/Library/Refresh`);
  });

  it('reports an unreachable server, retryable unless refused', async () => {
    const plugin = fakePluginContext({ settings, responses: [] });
    const p = '/data/shows/a.mkv';
    const res = await runFinishRun(refresh, runCtx(plugin, { originalPath: p, newPath: p }), {});
    expect(res).toEqual({ ok: false, retryable: true, message: 'Jellyfin unreachable: failed' });
  });

  it('maps movies, and leaves a sibling folder that only shares a string prefix alone', async () => {
    const plugin = fakePluginContext({
      settings,
      mappings: MAPPINGS,
      responses: [
        { ...UPDATED, status: 204 },
        { ...UPDATED, status: 204 },
      ],
    });
    const movie = '/data/movies/Example Movie (2020)/Example Movie.mkv';
    const first = await runFinishRun(
      refresh,
      runCtx(plugin, { originalPath: movie, newPath: movie }),
      {},
    );
    expect(first).toEqual({
      ok: true,
      message: 'asked Jellyfin to rescan /movies/Example Movie (2020)/Example Movie.mkv',
    });
    const sibling = '/data/showsx/x.mkv';
    await runFinishRun(refresh, runCtx(plugin, { originalPath: sibling, newPath: sibling }), {});
    expect(plugin.calls[1]?.body).toEqual({
      Updates: [{ Path: '/data/showsx/x.mkv', UpdateType: 'Modified' }],
    });
  });

  it('is not retryable when the connection is refused', async () => {
    const plugin = fakePluginContext({ settings });
    plugin.fetch = async () => {
      throw new FetchRefused('refused');
    };
    const p = '/data/shows/a.mkv';
    const res = await runFinishRun(refresh, runCtx(plugin, { originalPath: p, newPath: p }), {});
    expect(res).toEqual({ ok: false, retryable: false, message: 'Jellyfin unreachable: refused' });
  });
});
