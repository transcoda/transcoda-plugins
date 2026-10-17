import type { HookJob } from '@transcoda/sdk';
import { fakePluginContext, type ScriptedResponse } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { hooks } from './index.ts';

const HOOK = 'https://discord.com/api/webhooks/123456/tok_en-1';
const job: HookJob = {
  id: 'j1',
  runId: 'r1',
  workflowId: 'w1',
  workflowName: 'Shrink shows',
  workflowVersion: 1,
  path: '/data/shows/Example Show/S01E01.mkv',
  outcome: 'failed',
  reason: 'ffmpeg exited 1',
  beforeBytes: null,
  afterBytes: null,
  replacedTo: null,
  problems: [],
  dryRun: false,
  jobUrl: null,
};
const post = (r: Partial<ScriptedResponse> = {}): ScriptedResponse => ({
  match: { url: HOOK, method: 'POST' },
  status: 204,
  ...r,
});

describe('onJobFailed', () => {
  it('does nothing unless notifyOnFailed is on', async () => {
    const ctx = fakePluginContext({ settings: { webhookUrl: HOOK, notifyOnFailed: false } });
    await hooks.onJobFailed?.(ctx, job);
    expect(ctx.calls).toHaveLength(0);
  });

  it('posts the failed embed with the reason', async () => {
    const ctx = fakePluginContext({
      settings: { webhookUrl: HOOK, notifyOnFailed: true },
      responses: [post()],
    });
    await hooks.onJobFailed?.(ctx, job);
    const body = ctx.calls[0]?.body as {
      embeds: Array<{ color: number; fields: unknown[] }>;
      username: string;
    };
    expect(body.username).toBe('Transcoda');
    expect((body.embeds[0] as { title?: string }).title).toBe('Shrink shows');
    expect(body.embeds[0]?.color).toBe(0xc62828);
    expect(body.embeds[0]?.fields).toContainEqual({
      name: 'Reason',
      value: 'ffmpeg exited 1',
      inline: false,
    });
  });

  it('never throws; a failure is logged without the url', async () => {
    const ctx = fakePluginContext({
      settings: { webhookUrl: HOOK, notifyOnFailed: true },
      responses: [post({ status: 500 })],
    });
    await expect(hooks.onJobFailed?.(ctx, job)).resolves.toBeUndefined();
    expect(ctx.logs.some(([, m]) => m.includes('Discord answered 500'))).toBe(true);
    expect(ctx.logs.every(([, m]) => !m.includes('/api/webhooks/'))).toBe(true);
    const bare = fakePluginContext({ settings: { webhookUrl: HOOK, notifyOnFailed: true } });
    await expect(hooks.onJobFailed?.(bare, job)).resolves.toBeUndefined();
  });
});
