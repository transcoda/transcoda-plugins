import { FetchRateLimited, FetchTimeout } from '@transcoda/sdk';
import {
  fakeHookContext,
  fakePluginContext,
  runFinish,
  type runFinishRun,
  type ScriptedResponse,
} from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { notify } from './notify.ts';

const HOOK = 'https://discord.com/api/webhooks/123456/tok_en-1';
const settings = { webhookUrl: HOOK, notifyOnFailed: false, username: 'Transcoda' };

function runCtx(
  responses: ScriptedResponse[],
  over: Partial<Parameters<typeof runFinishRun>[1]> = {},
) {
  const plugin = fakePluginContext({ settings, responses });
  const ctx = {
    ...fakeHookContext({ plugin }),
    originalPath: '/data/shows/Example Show/S01E01.mkv',
    newPath: '/data/shows/Example Show/S01E01.mkv',
    replacedTo: 'recycle' as const,
    beforeBytes: 1_200_000_000,
    afterBytes: 900_000_000,
    outcome: 'replaced' as const,
    containerChanged: false,
    problemsSoFar: [] as string[],
    jobUrl: null as string | null,
    // Empty = no name (an older core): the plugin falls back to its default title.
    workflowName: '',
    ...over,
  };
  return { ctx, plugin };
}
const post = (r: Partial<ScriptedResponse> = {}): ScriptedResponse => ({
  match: { url: HOOK, method: 'POST' },
  status: 204,
  ...r,
});
const bodyOf = (plugin: { calls: Array<{ body?: unknown }> }, i = 0) =>
  plugin.calls[i]?.body as Record<string, unknown>;

describe('discord:notify finish', () => {
  it('declares one optional plugin action', async () => {
    const r = await runFinish(notify, fakeHookContext() as never, {});
    expect(r).toEqual({
      actions: [{ kind: 'plugin', description: 'post to Discord', required: false }],
      reason: 'notify after the write',
    });
    expect(notify.finishPhase).toBe('notify');
    expect(notify.outputs).toEqual([]);
  });
});

describe('discord:notify run', () => {
  const run = notify;
  const go = (c: ReturnType<typeof runCtx>['ctx'], s: unknown = {}) =>
    run.run?.(c, run.settings.parse(s));

  it('posts an embed with allowed_mentions.parse empty and no mention by default', async () => {
    const { ctx, plugin } = runCtx([post()]);
    expect(await go(ctx)).toEqual({ ok: true, message: 'posted to Discord' });
    const body = bodyOf(plugin);
    expect((body.embeds as Array<{ title: string }>)[0]?.title).toBe('Transcoda');
    expect(body.username).toBe('Transcoda');
    expect(body.allowed_mentions).toEqual({ parse: [], roles: [] });
    expect(body).not.toHaveProperty('content');
    expect((body.embeds as unknown[]).length).toBe(1);
    expect(plugin.calls[0]).toMatchObject({ method: 'POST', timeoutMs: 70_000 });
  });

  it('mentions the role only when there are problems and a role id', async () => {
    const withProblems = runCtx([post()], { problemsSoFar: ['x'] });
    await go(withProblems.ctx, { mentionRoleId: '1234567' });
    expect(bodyOf(withProblems.plugin)).toMatchObject({
      content: '<@&1234567>',
      allowed_mentions: { parse: [], roles: ['1234567'] },
    });
    const clean = runCtx([post()]);
    await go(clean.ctx, { mentionRoleId: '1234567' });
    expect(bodyOf(clean.plugin)).not.toHaveProperty('content');
    expect(bodyOf(clean.plugin).allowed_mentions).toEqual({ parse: [], roles: [] });
    const noRole = runCtx([post()], { problemsSoFar: ['x'] });
    await go(noRole.ctx);
    expect(bodyOf(noRole.plugin)).not.toHaveProperty('content');
  });

  it('puts the problems in the embed', async () => {
    const { ctx, plugin } = runCtx([post()], { problemsSoFar: ['subtitle dropped'] });
    await go(ctx);
    const embed = (
      bodyOf(plugin).embeds as Array<{ fields: Array<{ name: string; value: string }> }>
    )[0];
    expect(embed?.fields).toContainEqual(
      expect.objectContaining({ name: 'Needs attention', value: 'subtitle dropped' }),
    );
  });

  it('events=problems-only skips a clean job but sends one with problems; done always sends', async () => {
    const skip = runCtx([]);
    expect(await go(skip.ctx, { events: 'problems-only' })).toMatchObject({ ok: true });
    expect(skip.plugin.calls).toHaveLength(0);
    const send = runCtx([post()], { problemsSoFar: ['x'] });
    await go(send.ctx, { events: 'problems-only' });
    expect(send.plugin.calls).toHaveLength(1);
    const done = runCtx([post()], { problemsSoFar: ['x'] });
    await go(done.ctx, { events: 'done' });
    expect(done.plugin.calls).toHaveLength(1);
    const doneClean = runCtx([post()]);
    await go(doneClean.ctx, { events: 'done' });
    expect(doneClean.plugin.calls).toHaveLength(1);
  });

  it('does not retry a 429 itself (the host proxy already did) and is rate-limit worded', async () => {
    const { ctx, plugin } = runCtx([post({ status: 429, body: { retry_after: 1 } }), post()]);
    const r = await go(ctx);
    expect(r).toEqual({ ok: false, message: 'Discord rate limit; try again later' });
    expect(plugin.calls).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain('/api/webhooks/');
  });

  it('sends one 70 s deadline so a long Retry-After is not reported as a timeout', async () => {
    const { ctx, plugin } = runCtx([post()]);
    await go(ctx);
    expect(plugin.calls[0]?.timeoutMs).toBe(70_000);
  });

  it('titles the embed with the workflow name, falling back to Transcoda', async () => {
    const named = runCtx([post()]);
    await go({ ...named.ctx, workflowName: 'Shrink shows' } as never);
    expect((bodyOf(named.plugin).embeds as Array<{ title: string }>)[0]?.title).toBe(
      'Shrink shows',
    );
    const old = runCtx([post()]);
    await go(old.ctx);
    expect((bodyOf(old.plugin).embeds as Array<{ title: string }>)[0]?.title).toBe('Transcoda');
  });

  it('maps FetchRateLimited (a second 429 at the proxy) to the same message', async () => {
    const { ctx, plugin } = runCtx([]);
    plugin.fetch = async () => {
      throw new FetchRateLimited(`rate limited ${HOOK}`);
    };
    expect(await go(ctx)).toEqual({
      ok: false,
      message: 'Discord rate limit; try again later',
    });
  });

  it('answers 401/404 and other statuses readably', async () => {
    for (const status of [401, 404]) {
      const { ctx } = runCtx([post({ status })]);
      expect(await go(ctx)).toEqual({ ok: false, message: 'Discord does not know this webhook' });
    }
    const { ctx } = runCtx([post({ status: 500 })]);
    expect(await go(ctx)).toEqual({ ok: false, message: 'Discord answered 500' });
  });

  it('maps fetch errors, retryable only on timeout, never echoing the url', async () => {
    const t = runCtx([]);
    t.plugin.fetch = async () => {
      throw new FetchTimeout(`timeout ${HOOK}`);
    };
    expect(await go(t.ctx)).toEqual({
      ok: false,
      retryable: true,
      message: 'Discord unreachable: timeout',
    });
    const f = runCtx([]);
    const r = await go(f.ctx);
    expect(r).toEqual({ ok: false, retryable: false, message: 'Discord unreachable: failed' });
  });

  it('uses the username setting and the job url', async () => {
    const { ctx, plugin } = runCtx([post()], { jobUrl: 'https://t.example/jobs/9' });
    (ctx.plugin.settings as Record<string, unknown>).username = 'Shrinker';
    await go(ctx);
    expect(bodyOf(plugin).username).toBe('Shrinker');
    const embed = (bodyOf(plugin).embeds as Array<{ url?: string }>)[0];
    expect(embed?.url).toBe('https://t.example/jobs/9');
  });
});
