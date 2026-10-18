// Shared by the tests only; index.ts never imports it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FakePluginContext, ScriptedResponse } from '@transcoda/sdk/testing';
import { fakeHookContext } from '@transcoda/sdk/testing';

export const BASE = 'http://nas:8989';
export const SENTINEL = 'SENTINEL-SECRET-9f3a';
export const settings = { url: BASE, apiKey: 'key-1' };

export const series = arrFixture('series') as Array<Record<string, unknown>>;
export const SHOW = { ...series[0], path: '/data/shows/Show', title: 'Show', id: 1 };
export const SHOW2 = { ...series[1], path: '/data/shows/Show 2', title: 'Show 2', id: 2 };

export const get = (path: string, body: unknown, status = 200): ScriptedResponse => ({
  match: { url: BASE + path, method: 'GET' },
  status,
  body: body as never,
});
export const post = (path: string, body: unknown): ScriptedResponse => ({
  match: { url: BASE + path, method: 'POST' },
  body: body as never,
});

export const epFile = (id: number, seriesId: number, path: string) => ({
  ...(arrFixture('episodefile') as Array<Record<string, unknown>>)[0],
  id,
  seriesId,
  path,
});
export const episode = (id: number, seriesId: number, fileId: number, n: number, season = 1) => ({
  ...(arrFixture('episode') as Array<Record<string, unknown>>)[0],
  id,
  seriesId,
  episodeFileId: fileId,
  seasonNumber: season,
  episodeNumber: n,
});

export function runCtx(plugin: FakePluginContext, over: Record<string, unknown> = {}) {
  return {
    ...fakeHookContext({ plugin }),
    originalPath: '/data/shows/Show/S01E03.mkv',
    newPath: '/data/shows/Show/S01E03.mkv',
    replacedTo: 'recycle' as const,
    beforeBytes: 10,
    afterBytes: 8,
    outcome: 'replaced' as const,
    containerChanged: false,
    problemsSoFar: [],
    jobUrl: null,
    workflowName: 'Test workflow',
    ...over,
  };
}

/** A recorded JSON fixture from test/fixtures/arr. */
export function arrFixture(name: string): unknown {
  const url = new URL(`../../../test/fixtures/arr/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}
