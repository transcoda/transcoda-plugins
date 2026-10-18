// Test-only helpers. Nothing here is imported by index.ts, so none of it reaches the bundle.
import type { JsonValue } from '@transcoda/plugin-arr-common';
import type { FinishRunContext } from '@transcoda/sdk';
import { type FakePluginContext, fakeHookContext, fakePluginContext } from '@transcoda/sdk/testing';
import { arrFixture } from '../../../packages/arr-common/src/fixtures.ts';

export const SENTINEL = 'SENTINEL-SECRET-9f3a';
export const BASE = 'http://radarr:7878';
export const fixture = arrFixture as (name: string) => JsonValue;

export type Responses = NonNullable<Parameters<typeof fakePluginContext>[0]>['responses'];

export const settings = (extra: Record<string, JsonValue> = {}): Record<string, JsonValue> => ({
  url: BASE,
  apiKey: SENTINEL,
  pathMappings: [],
  allowInsecureTls: false,
  ...extra,
});

export function ctxWith(
  responses: Responses,
  opts: {
    mappings?: Array<{ remote: string; local: string }>;
    settings?: Record<string, JsonValue>;
  } = {},
): FakePluginContext {
  return fakePluginContext({
    settings: opts.settings ?? settings(),
    responses,
    mappings: opts.mappings ?? [],
  });
}

export function runContext(
  plugin: FakePluginContext,
  over: Partial<FinishRunContext> = {},
): FinishRunContext {
  return {
    ...fakeHookContext({ plugin }),
    originalPath: '/data/movies/Example Movie (2019)/Example Movie (2019).mkv',
    newPath: '/data/movies/Example Movie (2019)/Example Movie (2019).mkv',
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

/** A movie with a movieFile and an original language, on top of the recorded fixture. */
export function movies(extra: Record<string, JsonValue> = {}): JsonValue {
  const [m] = fixture('movie') as Array<Record<string, JsonValue>>;
  return [{ ...m, originalLanguage: { id: 8, name: 'Japanese' }, ...extra }];
}
