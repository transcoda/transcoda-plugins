import { FetchRefused } from '@transcoda/sdk';
import {
  fakeHookContext,
  fakePluginContext,
  runFinish,
  runFinishRun,
  runTest,
} from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { BASE, jellyfinFixture, KEY, settings } from '../test/fixtures.ts';
import plugin from './index.ts';
import { integration } from './integration.ts';
import { refresh } from './refresh.ts';

const pub = jellyfinFixture('system-info-public');
const info = jellyfinFixture('system-info');

function scripted(): ReturnType<typeof fakePluginContext> {
  return fakePluginContext({
    settings,
    mappings: [{ local: '/data/shows', remote: '/shows' }],
    responses: [
      { match: { url: `${BASE}/System/Info/Public` }, body: pub },
      { match: { url: `${BASE}/System/Info` }, status: 401 },
      { match: { url: `${BASE}/System/Info` }, body: info },
      { match: { url: `${BASE}/Library/Media/Updated` }, status: 500 },
      { match: { url: `${BASE}/Library/Media/Updated` }, status: 204 },
      { match: { url: `${BASE}/Library/Refresh` }, status: 204 },
    ],
  });
}

function assertClean(ctx: ReturnType<typeof fakePluginContext>, outputs: unknown[]) {
  for (const [, line] of ctx.logs) expect(line).not.toContain(KEY);
  expect(JSON.stringify(outputs)).not.toContain(KEY);
  for (const call of ctx.calls) {
    expect(call.url).not.toContain(KEY);
    expect(JSON.stringify(call.headers ?? {})).not.toContain(KEY);
    expect(JSON.stringify(call.body ?? null)).not.toContain(KEY);
  }
}

describe('secret hygiene', () => {
  it('keeps the key inside auth for test(), finish and run', async () => {
    const ctx = scripted();
    const outputs: unknown[] = [];
    outputs.push(await runTest(integration, ctx));
    const base = fakeHookContext({ plugin: ctx });
    outputs.push(await runFinish(refresh, { ...base, model: {} as never }, {}));
    const run = {
      ...base,
      originalPath: '/data/shows/a.avi',
      newPath: '/data/shows/a.mkv',
      replacedTo: 'recycle' as const,
      beforeBytes: 10,
      afterBytes: 8,
      outcome: 'replaced' as const,
      containerChanged: false,
      problemsSoFar: [],
      jobUrl: null,
    };
    outputs.push(await runFinishRun(refresh, run, {}));
    outputs.push(await runFinishRun(refresh, run, {}));
    outputs.push(await runFinishRun(refresh, run, { scope: 'library' }));
    assertClean(ctx, outputs);
    const authed = ctx.calls.filter((c) => c.auth !== undefined);
    expect(authed.length).toBeGreaterThan(0);
    for (const c of authed) expect(JSON.stringify(c.auth)).toContain(KEY);
  });

  it('keeps the key out of thrown and returned errors', async () => {
    const ctx = fakePluginContext({ settings });
    ctx.fetch = async (input) => {
      ctx.calls.push(input);
      // only an authenticated call is refused, so the authed path is exercised
      if (input.auth === undefined) {
        return { status: 200, headers: {}, body: pub };
      }
      throw new FetchRefused('connection refused');
    };
    const base = fakeHookContext({ plugin: ctx });
    const out = [
      await runTest(integration, ctx),
      await runFinishRun(
        refresh,
        {
          ...base,
          originalPath: '/a.mkv',
          newPath: '/a.mkv',
          replacedTo: null,
          beforeBytes: 1,
          afterBytes: 1,
          outcome: 'replaced',
          containerChanged: false,
          problemsSoFar: [],
          jobUrl: null,
        },
        {},
      ),
    ];
    assertClean(ctx, out);
  });

  it('the plugin declares no hooks that could leak and one secret setting', () => {
    expect(plugin.hooks).toBeUndefined();
  });
});
