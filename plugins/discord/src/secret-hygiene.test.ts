import {
  FetchFailed,
  FetchRateLimited,
  FetchTimeout,
  type HookJob,
  integrationMetadata,
  nodeMetadata,
  pluginManifest,
  secretPaths,
} from '@transcoda/sdk';
import {
  fakeHookContext,
  fakePluginContext,
  runTest,
  type ScriptedResponse,
} from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import plugin, { hooks, integration, notify } from './index.ts';

const SENTINEL = 'SENTINEL-SECRET-9f3a';
const HOOK = `https://discord.com/api/webhooks/1/${SENTINEL}`;
const settings = { webhookUrl: HOOK, notifyOnFailed: true, username: 'Transcoda' };

const echoing = (status: number): ScriptedResponse[] => [
  { match: { url: HOOK }, status, body: { message: 'nope', name: 'Hook', channel_id: '5' } },
  { match: { url: HOOK }, status, body: { message: 'nope' } },
];
const failing = (err: Error) => {
  const ctx = fakePluginContext({ settings });
  ctx.fetch = async (input) => {
    ctx.calls.push(input);
    throw err;
  };
  return ctx;
};

const job: HookJob = {
  id: 'j',
  runId: 'r',
  workflowId: 'w',
  workflowName: 'W',
  workflowVersion: 1,
  path: '/a/b.mkv',
  outcome: 'failed',
  reason: 'boom',
  beforeBytes: null,
  afterBytes: null,
  replacedTo: null,
  problems: ['p'],
  dryRun: false,
  jobUrl: null,
} as const;

function expectClean(ctx: ReturnType<typeof fakePluginContext>, results: unknown[]) {
  const hay = [
    ...ctx.logs.map(([, m]) => m),
    ...results.map((r) => JSON.stringify(r)),
    ...ctx.calls.map((c) => JSON.stringify({ h: c.headers ?? null, b: c.body ?? null })),
  ].join('\n');
  expect(hay).not.toContain(SENTINEL);
  expect(hay).not.toContain('/api/webhooks/');
  expect(hay).not.toContain('webhooks');
}

describe('secret hygiene', () => {
  const runCtx = (plug: ReturnType<typeof fakePluginContext>) => ({
    ...fakeHookContext({ plugin: plug }),
    originalPath: '/a/b.mkv',
    newPath: '/a/b.mkv',
    replacedTo: 'recycle' as const,
    beforeBytes: 10,
    afterBytes: 8,
    outcome: 'replaced' as const,
    containerChanged: false,
    problemsSoFar: ['p'],
    jobUrl: null,
    workflowName: 'W',
  });

  it('keeps the webhook url out of everything but the request target', async () => {
    for (const status of [200, 204, 401, 404, 429, 500]) {
      const results: unknown[] = [];
      const t = fakePluginContext({ settings, responses: echoing(status) });
      results.push(await runTest(integration, t));
      const r = fakePluginContext({ settings, responses: echoing(status) });
      results.push(await notify.run?.(runCtx(r), notify.settings.parse({})));
      const h = fakePluginContext({ settings, responses: echoing(status) });
      await hooks.onJobFailed?.(h, job);
      for (const c of [t, r, h]) {
        expect(c.calls.length).toBeGreaterThan(0);
        for (const call of c.calls) expect(call.url).toBe(HOOK);
        expectClean(c, results);
      }
    }
  });

  it('keeps it out of errors from the fetch layer', async () => {
    for (const err of [
      new FetchFailed(`failed ${HOOK}`),
      new FetchTimeout(`timeout ${HOOK}`),
      new FetchRateLimited(`limited ${HOOK}`),
      new Error(`weird ${HOOK}`),
    ]) {
      const results: unknown[] = [];
      const t = failing(err);
      results.push(await runTest(integration, t));
      const r = failing(err);
      results.push(await notify.run?.(runCtx(r), notify.settings.parse({})));
      const h = failing(err);
      await hooks.onJobFailed?.(h, job);
      for (const c of [t, r, h]) expectClean(c, results);
    }
  });

  it('a bad-shape url is never echoed', async () => {
    const bad = `https://example.com/${SENTINEL}`;
    const ctx = fakePluginContext({ settings: { webhookUrl: bad } });
    const r = await runTest(integration, ctx);
    expect(JSON.stringify(r)).not.toContain(SENTINEL);
  });

  it('marks only webhookUrl as a secret field and no node setting as secret', () => {
    const meta = integrationMetadata(integration);
    expect(secretPaths(meta.settingsSchema)).toEqual(['webhookUrl']);
    expect(secretPaths(nodeMetadata(notify).settingsSchema)).toEqual([]);
    const m = pluginManifest(plugin);
    expect(m.integration).toBe('discord');
    expect(m.hooks).toEqual(['onJobFailed']);
    expect(m.nodes).toEqual(['discord:notify']);
  });
});
