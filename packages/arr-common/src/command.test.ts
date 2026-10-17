import { fakePluginContext } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { arrFixture } from './fixtures.ts';
import { arrClient, runCommand } from './index.ts';

const settings = { url: 'http://nas:8989', apiKey: 'SENTINEL-SECRET-9f3a' };
const queued = arrFixture('command-queued') as Record<string, unknown>;
const poll = (status: string, extra: Record<string, unknown> = {}) => ({
  match: { url: 'http://nas:8989/api/v3/command/4242', method: 'GET' as const },
  body: { ...queued, status, ...extra } as never,
});
const post = {
  match: { url: 'http://nas:8989/api/v3/command', method: 'POST' as const },
  body: queued as never,
};

function run(responses: ReturnType<typeof poll>[], timeoutMs = 60_000) {
  const ctx = fakePluginContext({ settings, responses: [post, ...responses] });
  let t = 0;
  const outcome = runCommand(
    ctx,
    arrClient(ctx, 'Sonarr'),
    { name: 'RescanSeries', seriesId: 8 },
    { timeoutMs, pollMs: 0, now: () => (t += 1000), sleep: async () => {} },
  );
  return { ctx, outcome };
}

describe('runCommand', () => {
  it('follows queued, started, completed', async () => {
    const { ctx, outcome } = run([poll('queued'), poll('started'), poll('completed')]);
    expect(await outcome).toEqual({ status: 'completed' });
    expect(ctx.calls[0]?.body).toEqual({ name: 'RescanSeries', seriesId: 8 });
  });
  it.each(['failed', 'aborted', 'cancelled', 'orphaned'])('ends %s as failed', async (s) => {
    const { outcome } = run([poll(s)]);
    expect(await outcome).toEqual({ status: 'failed', message: `command RescanSeries ended ${s}` });
  });
  it('adds a truncated exception', async () => {
    const { outcome } = run([poll('failed', { exception: 'x'.repeat(500) })]);
    const r = await outcome;
    expect(r.status === 'failed' && r.message).toBe(
      `command RescanSeries ended failed: ${'x'.repeat(200)}`,
    );
  });
  it('keeps polling through an unknown status', async () => {
    const { outcome } = run([poll('mystery'), poll('mystery'), poll('mystery'), poll('completed')]);
    expect(await outcome).toEqual({ status: 'completed' });
  });
  it('times out', async () => {
    const { outcome } = run(
      Array.from({ length: 20 }, () => poll('started')),
      5000,
    );
    expect(await outcome).toEqual({ status: 'timeout' });
  });
  it('fails when the command is not accepted', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [{ ...post, body: null as never }],
    });
    const r = await runCommand(
      ctx,
      arrClient(ctx, 'Sonarr'),
      { name: 'RescanSeries' },
      { timeoutMs: 1, pollMs: 0 },
    );
    expect(r).toEqual({ status: 'failed', message: 'command RescanSeries was not accepted' });
  });
  it('retries a poll that fails transiently', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [post, { ...poll('x'), status: 502, body: null }, poll('completed')],
    });
    let t = 0;
    const r = await runCommand(
      ctx,
      arrClient(ctx, 'Sonarr'),
      { name: 'RescanSeries' },
      { timeoutMs: 60_000, pollMs: 0, now: () => (t += 1000), sleep: async () => {} },
    );
    expect(r).toEqual({ status: 'completed' });
  });
  it('returns failed with the last error when polls keep failing to the deadline', async () => {
    const ctx = fakePluginContext({ settings, responses: [post] }); // polls: unscripted -> FetchFailed
    let t = 0;
    const r = await runCommand(
      ctx,
      arrClient(ctx, 'Sonarr'),
      { name: 'RescanSeries' },
      { timeoutMs: 5000, pollMs: 0, now: () => (t += 1000), sleep: async () => {} },
    );
    expect(r.status).toBe('failed');
    expect(r.status === 'failed' && r.message).toMatch(/^command RescanSeries status unknown: /);
  });
  it('clamps the sleep to the remaining time and sends a per-request timeout', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [post, poll('started'), poll('started')],
    });
    const sleeps: number[] = [];
    let t = 0;
    const r = await runCommand(
      ctx,
      arrClient(ctx, 'Sonarr'),
      { name: 'RescanSeries' },
      {
        timeoutMs: 2500,
        pollMs: 2000,
        now: () => t,
        sleep: async (ms) => {
          sleeps.push(ms);
          t += ms;
        },
      },
    );
    expect(r).toEqual({ status: 'timeout' });
    expect(sleeps).toEqual([2000, 500]);
    expect(ctx.calls.every((c) => c.timeoutMs === 10_000)).toBe(true);
    const ctx2 = fakePluginContext({ settings, responses: [post] });
    await arrClient(ctx2, 'Sonarr', { timeoutMs: 3000 })
      .post('/api/v3/command', {})
      .catch(() => {});
    expect(ctx2.calls[0]?.timeoutMs).toBe(3000);
  });
});
