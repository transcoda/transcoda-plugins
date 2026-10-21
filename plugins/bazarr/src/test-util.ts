// Test-only helpers. Nothing here is imported by index.ts, so none of it reaches the bundle.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { JsonValue } from '@transcoda/plugin-arr-common';
import type { BuildContext, BuildModel, FinishRunContext } from '@transcoda/sdk';
import { type FakePluginContext, fakeHookContext, fakePluginContext } from '@transcoda/sdk/testing';

export const SENTINEL = 'SENTINEL-SECRET-9f3a';
export const BASE = 'http://192.0.2.10:6767';

export const EPISODE_FILE = '/data/shows/Example Show/Season 1/Example Show - S01E03.mkv';
export const MOVIE_FILE = '/data/movies/Example Movie (2001)/Example Movie (2001).mkv';

export type FixtureName = 'system-status' | 'series' | 'episodes' | 'movies' | 'movies-one';

export function fixture(name: FixtureName): JsonValue {
  const url = new URL(`../../../test/fixtures/bazarr/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as JsonValue;
}

export type Responses = NonNullable<Parameters<typeof fakePluginContext>[0]>['responses'];

export const settings = (extra: Record<string, JsonValue> = {}): Record<string, JsonValue> => ({
  url: BASE,
  apiKey: SENTINEL,
  pathMappings: [],
  timeoutSeconds: 30,
  allowInsecureTls: false,
  ...extra,
});

export function ctxWith(
  responses: Responses,
  opts: {
    mappings?: Array<{ remote: string; local: string }>;
    settings?: Record<string, JsonValue>;
    dryRun?: boolean;
  } = {},
): FakePluginContext {
  return fakePluginContext({
    settings: opts.settings ?? settings(),
    responses,
    mappings: opts.mappings ?? [],
    dryRun: opts.dryRun ?? false,
  });
}

export const MODEL: BuildModel = {
  container: 'mkv',
  streams: [],
  targets: [],
  inputArgs: [],
  globalArgs: [],
};

/** A hook context for the file at `path` (a local path). */
export function hookContext(plugin: FakePluginContext, path: string) {
  const base = fakeHookContext({ plugin });
  return { ...base, file: { ...base.file, path } };
}

export function buildContext(plugin: FakePluginContext, path: string): BuildContext {
  return { ...hookContext(plugin, path), model: MODEL };
}

export function runContext(
  plugin: FakePluginContext,
  over: Partial<FinishRunContext> = {},
): FinishRunContext {
  return {
    ...fakeHookContext({ plugin }),
    originalPath: EPISODE_FILE,
    newPath: EPISODE_FILE,
    replacedTo: 'recycle',
    beforeBytes: 10,
    afterBytes: 8,
    outcome: 'replaced',
    containerChanged: false,
    problemsSoFar: [],
    jobUrl: null,
    workflowName: 'Test workflow',
    ...over,
  };
}

/** A fetch failure as a plugin bundle sees it: a plain Error with `name` and `kind`. */
export function fetchFailure(kind: 'refused' | 'timeout' | 'rate-limited' | 'failed'): Error {
  return Object.assign(new Error(`scripted ${kind}`), { name: `Fetch-${kind}`, kind });
}

export const SERIES_URL = `${BASE}/api/series?start=0&length=-1`;
export const MOVIES_URL = `${BASE}/api/movies?start=0&length=-1`;
export const EPISODES_URL = `${BASE}/api/episodes?seriesid[]=1`;
export const EPISODE_ONE_URL = `${BASE}/api/episodes?episodeid[]=11`;
export const MOVIE_ONE_URL = `${BASE}/api/movies?radarrid[]=7`;
export const EPISODE_PATCH_URL = `${BASE}/api/episodes/subtitles?seriesid=1&episodeid=11&language=de&forced=False&hi=False`;
export const MOVIE_PATCH_URL = `${BASE}/api/movies/subtitles?radarrid=7&language=de&forced=False&hi=False`;
export const SERIES_SCAN_URL = `${BASE}/api/series?seriesid=1&action=scan-disk`;
export const MOVIE_SCAN_URL = `${BASE}/api/movies?radarrid=7&action=scan-disk`;
