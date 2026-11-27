import { FetchRefused, nodeMetadata } from '@transcoda/sdk';
import {
  fakeHookContext,
  fakePluginContext,
  runFinish,
  runFinishRun,
} from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { refresh } from './refresh.ts';
import { BASE, settings } from './test-util.ts';

const MAPPINGS = [
  { local: '/data/shows', remote: '/shows' },
  { local: '/data/movies', remote: '/movies' },
];
const UPDATED = { match: { url: `${BASE}/Library/Media/Updated`, method: 'POST' } };
const REFRESH = { match: { url: `${BASE}/Library/Refresh`, method: 'POST' } };
const FOLDERS = { match: { url: `${BASE}/Library/VirtualFolders`, method: 'GET' } };
/** Jellyfin has no library holding the file, so there is no item to read again. */
const NO_LIBRARY = { ...FOLDERS, body: [] };
const NO_ITEM = '; Jellyfin has no item for it yet';

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
    workflowName: 'Test workflow',
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
      responses: [{ ...UPDATED, status: 204 }, NO_LIBRARY],
    });
    const p = '/data/shows/Example Show/S01E01.mkv';
    const res = await runFinishRun(refresh, runCtx(plugin, { originalPath: p, newPath: p }), {});
    expect(res).toEqual({
      ok: true,
      message: `asked Jellyfin to rescan /shows/Example Show/S01E01.mkv${NO_ITEM}`,
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
    expect(res).toEqual({
      ok: true,
      message: 'asked Jellyfin to rescan /shows/Example Show/S01E01.mkv',
    });
    expect(plugin.calls[0]?.body).toEqual({
      Updates: [
        { Path: '/shows/Example Show/S01E01.mkv', UpdateType: 'Modified' },
        { Path: '/shows/Example Show/S01E01.avi', UpdateType: 'Deleted' },
      ],
    });
    // A new path is new to Jellyfin, which reads it in full: no item lookup.
    expect(plugin.calls).toHaveLength(1);
  });

  it('answers non-retryable not-ok on a 500', async () => {
    const plugin = fakePluginContext({ settings, responses: [{ ...UPDATED, status: 500 }] });
    const p = '/data/shows/a.mkv';
    const res = await runFinishRun(refresh, runCtx(plugin, { originalPath: p, newPath: p }), {});
    expect(res).toEqual({ ok: false, message: 'Jellyfin answered 500 to the rescan request' });
  });

  it('scans every library with scope library', async () => {
    const plugin = fakePluginContext({
      settings,
      responses: [{ ...REFRESH, status: 204 }, NO_LIBRARY],
    });
    const p = '/data/shows/a.mkv';
    const res = await runFinishRun(refresh, runCtx(plugin, { originalPath: p, newPath: p }), {
      scope: 'library',
    });
    expect(res).toEqual({ ok: true, message: `asked Jellyfin to rescan every library${NO_ITEM}` });
    expect(plugin.calls).toHaveLength(2);
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
      responses: [{ ...UPDATED, status: 204 }, NO_LIBRARY, { ...UPDATED, status: 204 }, NO_LIBRARY],
    });
    const movie = '/data/movies/Example Movie (2020)/Example Movie.mkv';
    const first = await runFinishRun(
      refresh,
      runCtx(plugin, { originalPath: movie, newPath: movie }),
      {},
    );
    expect(first).toEqual({
      ok: true,
      message: `asked Jellyfin to rescan /movies/Example Movie (2020)/Example Movie.mkv${NO_ITEM}`,
    });
    const sibling = '/data/showsx/x.mkv';
    await runFinishRun(refresh, runCtx(plugin, { originalPath: sibling, newPath: sibling }), {});
    expect(plugin.calls[2]?.body).toEqual({
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
  describe('reading a file replaced in place', () => {
    const FOLDER_LIST = {
      ...FOLDERS,
      body: [
        { Name: 'Shows', ItemId: 'lib-shows', Locations: ['/shows'] },
        { Name: 'Movies', ItemId: 'lib-movies', Locations: ['/movies'] },
      ],
    };
    const children = (parentId: string, items: { Id: string; Path?: string }[]) => ({
      match: {
        url: new RegExp(`/Items\\?parentId=${parentId}&fields=Path(?!.*recursive)`),
        method: 'GET',
      },
      body: { Items: items },
    });
    const subtree = (parentId: string, items: { Id: string; Path?: string }[]) => ({
      match: {
        url: new RegExp(`/Items\\?parentId=${parentId}&.*recursive=true&filters=IsNotFolder$`),
        method: 'GET',
      },
      body: { Items: items },
    });
    const reread = (id: string, status = 204) => ({
      match: { url: new RegExp(`/Items/${id}/Refresh\\?`), method: 'POST' },
      status,
    });
    const movie = '/data/movies/Example Movie (2020)/Example Movie.mkv';

    it('finds the movie and has Jellyfin read it again without replacing metadata', async () => {
      const plugin = fakePluginContext({
        settings,
        mappings: MAPPINGS,
        responses: [
          { ...UPDATED, status: 204 },
          FOLDER_LIST,
          children('lib-movies', [
            { Id: 'other', Path: '/movies/Other Movie (2019)/Other Movie.mkv' },
            { Id: 'movie-1', Path: '/movies/Example Movie (2020)/Example Movie.mkv' },
          ]),
          reread('movie-1'),
        ],
      });
      const res = await runFinishRun(
        refresh,
        runCtx(plugin, { originalPath: movie, newPath: movie }),
        {},
      );
      expect(res).toEqual({
        ok: true,
        message:
          'asked Jellyfin to rescan /movies/Example Movie (2020)/Example Movie.mkv and to read the new file',
      });
      const call = plugin.calls.at(-1);
      expect(call?.method).toBe('POST');
      const q = new URL(call?.url ?? '').searchParams;
      expect(Object.fromEntries(q)).toEqual({
        metadataRefreshMode: 'FullRefresh',
        imageRefreshMode: 'Default',
        replaceAllMetadata: 'false',
        replaceAllImages: 'false',
        regenerateTrickplay: 'false',
      });
    });

    it('walks series and season folders down to the episode', async () => {
      const p = '/data/shows/Example Show/Season 01/S01E02.mkv';
      const plugin = fakePluginContext({
        settings,
        mappings: MAPPINGS,
        responses: [
          { ...UPDATED, status: 204 },
          FOLDER_LIST,
          children('lib-shows', [
            { Id: 'show-x', Path: '/shows/Example Showx' },
            { Id: 'show-1', Path: '/shows/Example Show' },
          ]),
          children('show-1', [{ Id: 'season-1', Path: '/shows/Example Show/Season 01' }]),
          children('season-1', [
            { Id: 'ep-1', Path: '/shows/Example Show/Season 01/S01E01.mkv' },
            { Id: 'ep-2', Path: '/shows/Example Show/Season 01/S01E02.mkv' },
          ]),
          reread('ep-2'),
        ],
      });
      const res = await runFinishRun(refresh, runCtx(plugin, { originalPath: p, newPath: p }), {});
      expect(res.ok).toBe(true);
      expect(plugin.calls.at(-1)?.url).toMatch(/\/Items\/ep-2\/Refresh\?/);
    });

    it('searches the subtree when a season has no folder of its own', async () => {
      const p = '/data/shows/Example Show/S01E02.mkv';
      const plugin = fakePluginContext({
        settings,
        mappings: MAPPINGS,
        responses: [
          { ...UPDATED, status: 204 },
          FOLDER_LIST,
          children('lib-shows', [{ Id: 'show-1', Path: '/shows/Example Show' }]),
          children('show-1', [{ Id: 'season-1' }]),
          subtree('show-1', [
            { Id: 'ep-1', Path: '/shows/Example Show/S01E01.mkv' },
            { Id: 'ep-2', Path: '/shows/Example Show/S01E02.mkv' },
          ]),
          reread('ep-2'),
        ],
      });
      const res = await runFinishRun(refresh, runCtx(plugin, { originalPath: p, newPath: p }), {});
      expect(res.ok).toBe(true);
      expect(plugin.calls.at(-1)?.url).toMatch(/\/Items\/ep-2\/Refresh\?/);
    });

    it('finds an alternate version through the media sources of the item beside it', async () => {
      const alt = '/data/movies/Example Movie (2020)/Example Movie - 1080p.mkv';
      const primary = {
        Id: 'movie-1',
        Path: '/movies/Example Movie (2020)/Example Movie - 2160p.mkv',
      };
      const plugin = fakePluginContext({
        settings,
        mappings: MAPPINGS,
        responses: [
          { ...UPDATED, status: 204 },
          FOLDER_LIST,
          children('lib-movies', [primary]),
          subtree('lib-movies', [primary]),
          {
            match: { url: /\/Items\?ids=movie-1&fields=MediaSources&/, method: 'GET' },
            body: {
              Items: [
                {
                  Id: 'movie-1',
                  MediaSources: [
                    { Id: 'movie-1', Path: primary.Path },
                    { Id: 'alt-1', Path: '/movies/Example Movie (2020)/Example Movie - 1080p.mkv' },
                  ],
                },
              ],
            },
          },
          reread('alt-1'),
        ],
      });
      const res = await runFinishRun(
        refresh,
        runCtx(plugin, { originalPath: alt, newPath: alt }),
        {},
      );
      expect(res.ok).toBe(true);
      expect(plugin.calls.at(-1)?.url).toMatch(/\/Items\/alt-1\/Refresh\?/);
    });

    it('also reads the file again with scope library', async () => {
      const plugin = fakePluginContext({
        settings,
        mappings: MAPPINGS,
        responses: [
          { ...REFRESH, status: 204 },
          FOLDER_LIST,
          children('lib-movies', [
            { Id: 'movie-1', Path: '/movies/Example Movie (2020)/Example Movie.mkv' },
          ]),
          reread('movie-1'),
        ],
      });
      const res = await runFinishRun(
        refresh,
        runCtx(plugin, { originalPath: movie, newPath: movie }),
        { scope: 'library' },
      );
      expect(res).toEqual({
        ok: true,
        message: 'asked Jellyfin to rescan every library and to read the new file',
      });
    });

    it('is not ok when Jellyfin refuses to read the item again', async () => {
      const plugin = fakePluginContext({
        settings,
        mappings: MAPPINGS,
        responses: [
          { ...UPDATED, status: 204 },
          FOLDER_LIST,
          children('lib-movies', [
            { Id: 'movie-1', Path: '/movies/Example Movie (2020)/Example Movie.mkv' },
          ]),
          reread('movie-1', 500),
        ],
      });
      const res = await runFinishRun(
        refresh,
        runCtx(plugin, { originalPath: movie, newPath: movie }),
        {},
      );
      expect(res).toEqual({
        ok: false,
        message:
          'asked Jellyfin to rescan /movies/Example Movie (2020)/Example Movie.mkv, but Jellyfin answered 500 to the request to read it again',
      });
    });

    it('is not ok when the item lookup fails', async () => {
      const plugin = fakePluginContext({
        settings,
        mappings: MAPPINGS,
        responses: [
          { ...UPDATED, status: 204 },
          { ...FOLDERS, status: 403 },
        ],
      });
      const res = await runFinishRun(
        refresh,
        runCtx(plugin, { originalPath: movie, newPath: movie }),
        {},
      );
      expect(res).toEqual({
        ok: false,
        message:
          'asked Jellyfin to rescan /movies/Example Movie (2020)/Example Movie.mkv, but could not find its item: Jellyfin answered 403 to /Library/VirtualFolders',
      });
    });
  });
});
