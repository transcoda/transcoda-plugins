import { describe, expect, it } from 'vitest';
import { bodyOf, ctxWith, job, publishOk, timingOut } from './helpers.ts';
import plugin, { hooks, integration } from './index.ts';

describe('onJobFailed', () => {
  it('is the only hook', () => {
    expect(Object.keys(plugin.hooks ?? {})).toEqual(['onJobFailed']);
  });

  it('makes no call when notifyOnFailed is off', async () => {
    const ctx = ctxWith({ notifyOnFailed: false });
    await hooks.onJobFailed?.(ctx, job);
    expect(ctx.calls).toHaveLength(0);
  });

  it('makes no call when notifyOnFailed is unset', async () => {
    const ctx = ctxWith();
    await hooks.onJobFailed?.(ctx, job);
    expect(ctx.calls).toHaveLength(0);
  });

  it('makes no call for a dry run', async () => {
    const ctx = ctxWith({ notifyOnFailed: true });
    await hooks.onJobFailed?.(ctx, { ...job, dryRun: true });
    expect(ctx.calls).toHaveLength(0);
  });

  it('throws "rate limited" on a 429', async () => {
    const ctx = ctxWith({ notifyOnFailed: true, failedTopic: 'alerts' }, [publishOk(429)]);
    await expect(hooks.onJobFailed?.(ctx, job)).rejects.toThrow('ntfy rate limited');
  });

  it('posts to the failed topic with priority 4 and the reason', async () => {
    const ctx = ctxWith({ notifyOnFailed: true, failedTopic: 'alerts', token: 'tk_x' });
    await hooks.onJobFailed?.(ctx, job);
    expect(ctx.calls).toHaveLength(1);
    const call = ctx.calls[0];
    expect(call?.auth).toEqual({ bearer: 'tk_x' });
    expect(call?.body).toMatchObject({
      topic: 'alerts',
      title: 'Transcoda: job failed',
      priority: 4,
      tags: ['warning'],
      click: 'https://transcoda.example/jobs/j1',
    });
    const message = bodyOf(ctx).message;
    expect(message).toContain('S01E01.mkv');
    expect(message).toContain('failed');
    expect(message).toContain('Reason: ffmpeg exited 1');
  });

  it('omits click without a job URL', async () => {
    const ctx = ctxWith({ notifyOnFailed: true, failedTopic: 'alerts' });
    await hooks.onJobFailed?.(ctx, { ...job, jobUrl: null });
    expect(ctx.calls[0]?.body).toMatchObject({ topic: 'alerts' });
    expect(ctx.calls[0]?.body).not.toHaveProperty('click');
  });

  it('makes no call when notifyOnFailed is on but no failedTopic is set', async () => {
    for (const settings of [{ notifyOnFailed: true }, { notifyOnFailed: true, failedTopic: '' }]) {
      const ctx = ctxWith(settings);
      await hooks.onJobFailed?.(ctx, job);
      expect(ctx.calls).toHaveLength(0);
    }
  });

  it('has no default failed topic: the schema default is empty and an empty value is valid', () => {
    const parsed = integration.settings.parse({});
    expect(parsed.failedTopic).toBe('');
    expect(integration.settings.safeParse({ failedTopic: 'bad topic!' }).success).toBe(false);
  });

  it('throws on a refusal so the host logs it', async () => {
    const ctx = ctxWith({ notifyOnFailed: true, failedTopic: 'alerts' }, [publishOk(413)]);
    await expect(hooks.onJobFailed?.(ctx, job)).rejects.toThrow('too large');
  });

  it('throws when the server is unreachable', async () => {
    await expect(
      hooks.onJobFailed?.(timingOut({ notifyOnFailed: true, failedTopic: 'alerts' }), job),
    ).rejects.toThrow('ntfy unreachable: timeout');
  });
});
