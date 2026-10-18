import { FetchTimeout } from '@transcoda/sdk';
import {
  fakeHookContext,
  fakePluginContext,
  runData,
  runTest,
  type ScriptedResponse,
} from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { integration, originalLanguage } from './index.ts';

const SENTINEL = 'SENTINEL-SECRET-9f3a';

function assertClean(ctx: ReturnType<typeof fakePluginContext>, outputs: unknown[]) {
  expect(ctx.calls.length).toBeGreaterThan(0);
  for (const call of ctx.calls) {
    expect(call.url).not.toContain(SENTINEL);
    expect(JSON.stringify(call.headers ?? {})).not.toContain(SENTINEL);
    expect(JSON.stringify(call.body ?? null)).not.toContain(SENTINEL);
    // The sentinel is not a 32-hex key, so it travels as a bearer token inside auth only.
    expect(call.auth).toEqual({ bearer: SENTINEL });
  }
  expect(JSON.stringify(ctx.logs)).not.toContain(SENTINEL);
  expect(JSON.stringify(outputs)).not.toContain(SENTINEL);
}

const scenarios: Array<[string, ScriptedResponse[]]> = [
  ['success', [{ match: { url: /\/3\/movie\/1\?/ }, body: { original_language: 'en' } }]],
  ['401', [{ match: { url: /\/3\/movie\/1\?/ }, status: 401, body: { status_message: 'bad' } }]],
  ['429', [{ match: { url: /\/3\/movie\/1\?/ }, status: 429 }]],
  ['500', [{ match: { url: /\/3\/movie\/1\?/ }, status: 500 }]],
  ['unscripted', []],
];

describe('tmdb secret hygiene', () => {
  it.each(scenarios)('test() keeps the credential in auth only (%s)', async (_n, responses) => {
    const authResponses = responses.map((r) => ({ ...r, match: { url: /\/3\/authentication/ } }));
    const ctx = fakePluginContext({ settings: { credential: SENTINEL }, responses: authResponses });
    const result = await runTest(integration, ctx);
    assertClean(ctx, [result]);
  });

  it('test() on a thrown fetch error does not leak the credential', async () => {
    const base = fakePluginContext({ settings: { credential: SENTINEL } });
    const ctx = {
      ...base,
      async fetch(input: Parameters<typeof base.fetch>[0]): Promise<never> {
        base.calls.push(input);
        throw new FetchTimeout('timed out');
      },
    };
    const result = await runTest(integration, ctx);
    assertClean(base, [result]);
  });

  it.each(scenarios)(
    'the data node keeps the credential in auth only (%s)',
    async (_n, responses) => {
      const plugin = fakePluginContext({ settings: { credential: SENTINEL }, responses });
      const ctx = fakeHookContext({ plugin, data: { ids: { tmdbId: 1 }, title: 'unknown' } });
      let output: unknown;
      try {
        output = await runData(originalLanguage, ctx, { kind: 'movie' });
      } catch (error) {
        output = String(error);
      }
      assertClean(plugin, [output]);
    },
  );

  it('a key-shaped credential goes only into auth.query', async () => {
    const key = 'abcdef0123456789abcdef0123456789';
    const plugin = fakePluginContext({
      settings: { credential: key },
      responses: [{ match: { url: /\/3\/movie\/1\?/ }, body: { original_language: 'en' } }],
    });
    const ctx = fakeHookContext({ plugin, data: { ids: { tmdbId: 1 }, title: 'unknown' } });
    await runData(originalLanguage, ctx, { kind: 'movie' });
    const [call] = plugin.calls;
    expect(call?.auth).toEqual({ query: { name: 'api_key', value: key } });
    expect(call?.url).not.toContain(key);
    expect(JSON.stringify(call?.headers ?? {})).not.toContain(key);
    expect(JSON.stringify(plugin.logs)).not.toContain(key);
  });
});

describe('tmdb secret hygiene with a key-shaped credential', () => {
  // A 32-hex "key" containing the sentinel text would not be hex; use a hex key and look for it.
  const KEY = 'abcdef0123456789abcdef0123456789';
  const bad: Array<[string, ScriptedResponse[]]> = [
    [
      '401',
      [{ match: { url: /\/3\// }, status: 401, body: { status_message: 'Invalid API key' } }],
    ],
    ['429', [{ match: { url: /\/3\// }, status: 429 }]],
    ['500', [{ match: { url: /\/3\// }, status: 500 }]],
    ['unscripted', []],
  ];

  function clean(ctx: ReturnType<typeof fakePluginContext>, outputs: unknown[]) {
    expect(ctx.calls.length).toBeGreaterThan(0);
    for (const call of ctx.calls) {
      expect(call.auth).toEqual({ query: { name: 'api_key', value: KEY } });
      expect(call.url).not.toContain(KEY);
      expect(JSON.stringify(call.headers ?? {})).not.toContain(KEY);
      expect(JSON.stringify(call.body ?? null)).not.toContain(KEY);
    }
    expect(JSON.stringify(ctx.logs)).not.toContain(KEY);
    expect(JSON.stringify(outputs)).not.toContain(KEY);
  }

  it.each(bad)('test() (%s)', async (_n, responses) => {
    const ctx = fakePluginContext({ settings: { credential: KEY }, responses });
    clean(ctx, [await runTest(integration, ctx)]);
  });

  it.each(bad)('data node by id (%s)', async (_n, responses) => {
    const plugin = fakePluginContext({ settings: { credential: KEY }, responses });
    const ctx = fakeHookContext({ plugin, data: { ids: { tmdbId: 1 }, title: 'unknown' } });
    clean(plugin, [await runData(originalLanguage, ctx, {})]);
  });

  it.each(bad)('data node by title (%s)', async (_n, responses) => {
    const plugin = fakePluginContext({ settings: { credential: KEY }, responses });
    const ctx = fakeHookContext({ plugin, data: { ids: 'unknown', title: 'Heat (1995)' } });
    clean(plugin, [await runData(originalLanguage, ctx, { kind: 'movie' })]);
  });
});
