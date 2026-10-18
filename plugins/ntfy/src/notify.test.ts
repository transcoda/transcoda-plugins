import { definePlugin, FetchRateLimited, nodeMetadata } from '@transcoda/sdk';
import { runFinish, runFinishRun } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { bodyOf, ctxWith, publishOk, runContext, timingOut } from './helpers.ts';
import { notify } from './notify.ts';

const settings = { topic: 'media' };

describe('ntfy:notify finish', () => {
  it('declares one optional plugin action', async () => {
    const res = await runFinish(
      notify,
      { ...runContext(ctxWith()), model: undefined as never },
      settings,
    );
    expect(res.actions).toEqual([
      { kind: 'plugin', description: 'notify media through ntfy', required: false },
    ]);
    expect(res.reason).toBe('notify after the write');
  });

  it('is a notify-phase finish node with a run hook', () => {
    const meta = nodeMetadata(notify);
    expect(meta.finishPhase).toBe('notify');
    expect(meta.hooks).toContain('run');
    expect(() =>
      definePlugin({ name: 'ntfy', version: '1.0.0', sdk: '^1', nodes: [notify] }),
    ).not.toThrow();
  });

  it('rejects an invalid topic', () => {
    expect(() => notify.settings.parse({ topic: 'a b' })).toThrow();
  });
});

describe('ntfy:notify run', () => {
  it('posts the JSON payload without auth when no token is set', async () => {
    const ctx = ctxWith();
    const res = await runFinishRun(
      notify,
      runContext(ctx, { jobUrl: 'https://transcoda.example/jobs/j1' }),
      { topic: 'media', priority: 4, tags: ['tada'] },
    );
    expect(res).toEqual({ ok: true, message: 'sent to media' });
    expect(ctx.calls).toHaveLength(1);
    const call = ctx.calls[0];
    expect(call?.url).toBe('https://ntfy.example/');
    expect(call?.method).toBe('POST');
    expect(call?.timeoutMs).toBe(10_000);
    expect(call?.auth).toBeUndefined();
    expect(call?.body).toMatchObject({
      topic: 'media',
      title: 'Transcoda: job',
      priority: 4,
      tags: ['tada'],
      click: 'https://transcoda.example/jobs/j1',
    });
    expect(bodyOf(ctx).message).toContain('1.2 GB → 0.9 GB (−25 %)');
  });

  it('renders the title placeholders', async () => {
    const ctx = ctxWith();
    await runFinishRun(notify, runContext(ctx), {
      topic: 'media',
      title: '{{file}} {{outcome}}',
    });
    expect(bodyOf(ctx).title).toBe('S01E01.mkv replaced');
  });

  it('uses the workflow name from the run context, and "job" for an older core', async () => {
    const named = ctxWith();
    await runFinishRun(notify, { ...runContext(named), workflowName: 'Shrink' } as never, settings);
    expect(bodyOf(named).title).toBe('Transcoda: Shrink');
    const old = ctxWith();
    await runFinishRun(notify, runContext(old), settings);
    expect(bodyOf(old).title).toBe('Transcoda: job');
  });

  it('caps a long rendered title at 250 characters', async () => {
    const ctx = ctxWith();
    await runFinishRun(notify, runContext(ctx, { newPath: `/data/${'f'.repeat(100)}.mkv` }), {
      topic: 'media',
      title: `${'x'.repeat(180)}{{file}}{{file}}`,
    });
    expect([...bodyOf(ctx).title]).toHaveLength(250);
  });

  it('omits click when there is no job URL', async () => {
    const ctx = ctxWith();
    await runFinishRun(notify, runContext(ctx, { jobUrl: null }), settings);
    expect(ctx.calls[0]?.body).not.toHaveProperty('click');
  });

  it('sends the token as auth.bearer', async () => {
    const ctx = ctxWith({ token: 'tk_abc' });
    await runFinishRun(notify, runContext(ctx), settings);
    expect(ctx.calls[0]?.auth).toEqual({ bearer: 'tk_abc' });
  });

  describe('events gate (a user must never miss a job that needs attention)', () => {
    it('problems-only sends when there is a problem and carries it', async () => {
      const ctx = ctxWith();
      const res = await runFinishRun(
        notify,
        runContext(ctx, { problemsSoFar: ['Sonarr rescan timed out'] }),
        { topic: 'media', events: 'problems-only' },
      );
      expect(res.ok).toBe(true);
      expect(ctx.calls).toHaveLength(1);
      const body = bodyOf(ctx);
      expect(body.message).toContain('Problems:\nSonarr rescan timed out');
      expect(body.message).toContain('replaced · needs attention');
    });

    it('problems-only skips a clean job', async () => {
      const ctx = ctxWith();
      const res = await runFinishRun(notify, runContext(ctx), {
        topic: 'media',
        events: 'problems-only',
      });
      expect(res).toEqual({ ok: true, message: 'no problems; nothing sent' });
      expect(ctx.calls).toHaveLength(0);
    });

    it('done sends a clean job', async () => {
      const ctx = ctxWith();
      await runFinishRun(notify, runContext(ctx), { topic: 'media', events: 'done' });
      expect(ctx.calls).toHaveLength(1);
      expect(bodyOf(ctx).message).not.toContain('Problems:');
    });

    it('done still sends a job with problems and lists them', async () => {
      const ctx = ctxWith();
      await runFinishRun(notify, runContext(ctx, { problemsSoFar: ['p1', 'p2'] }), {
        topic: 'media',
        events: 'done',
      });
      expect(ctx.calls).toHaveLength(1);
      expect(bodyOf(ctx).message).toContain('Problems:\np1\np2');
    });
  });

  describe('failures are a readable ok:false', () => {
    it('413: too large', async () => {
      const ctx = ctxWith({ token: 'tk_secret' }, [publishOk(413)]);
      const res = await runFinishRun(notify, runContext(ctx), settings);
      expect(res).toEqual({
        ok: false,
        message: 'ntfy refused the message as too large',
        retryable: false,
      });
    });

    it.each([401, 403])('%i: token rejected', async (status) => {
      const ctx = ctxWith({ token: 'tk_secret' }, [publishOk(status)]);
      const res = await runFinishRun(notify, runContext(ctx), settings);
      expect(res.ok).toBe(false);
      expect(res.message).toBe('ntfy rejected the token for media');
      expect(res.message).not.toContain('tk_secret');
    });

    it('other statuses are reported', async () => {
      const res = await runFinishRun(notify, runContext(ctxWith({}, [publishOk(500)])), settings);
      expect(res).toMatchObject({ ok: false, message: 'ntfy answered 500' });
    });

    it('429 reads rate limited', async () => {
      const res = await runFinishRun(notify, runContext(ctxWith({}, [publishOk(429)])), settings);
      expect(res).toMatchObject({ ok: false, message: 'ntfy rate limited' });
    });

    it('a rate-limited fetch error reads rate limited', async () => {
      const ctx = ctxWith({}, []);
      ctx.fetch = async () => {
        throw new FetchRateLimited('slow down');
      };
      const res = await runFinishRun(notify, runContext(ctx), settings);
      expect(res).toMatchObject({ ok: false, message: 'ntfy rate limited' });
    });

    it('classifies a foreign error class by its kind (host SDK copy)', async () => {
      class HostTimeout extends Error {
        readonly kind = 'timeout';
      }
      const ctx = ctxWith({}, []);
      ctx.fetch = async () => {
        throw new HostTimeout('x');
      };
      const res = await runFinishRun(notify, runContext(ctx), settings);
      expect(res).toEqual({ ok: false, retryable: true, message: 'ntfy unreachable: timeout' });
      const plain = ctxWith({}, []);
      plain.fetch = async () => {
        throw new Error('boom');
      };
      await expect(runFinishRun(notify, runContext(plain), settings)).rejects.toThrow('boom');
    });

    it('classifies a plain Object.assign error by kind', async () => {
      const ctx = ctxWith({}, []);
      ctx.fetch = async () => {
        throw Object.assign(new Error('x'), { kind: 'timeout' });
      };
      expect(await runFinishRun(notify, runContext(ctx), settings)).toEqual({
        ok: false,
        retryable: true,
        message: 'ntfy unreachable: timeout',
      });
    });

    it('any 2xx is success', async () => {
      for (const status of [200, 201, 204]) {
        const res = await runFinishRun(
          notify,
          runContext(ctxWith({}, [publishOk(status)])),
          settings,
        );
        expect(res.ok).toBe(true);
      }
    });

    it('a timeout is retryable', async () => {
      const res = await runFinishRun(notify, runContext(timingOut()), settings);
      expect(res).toEqual({ ok: false, retryable: true, message: 'ntfy unreachable: timeout' });
    });

    it('an unreachable server is not retryable', async () => {
      const res = await runFinishRun(notify, runContext(ctxWith({}, [])), settings);
      expect(res).toEqual({ ok: false, retryable: false, message: 'ntfy unreachable: failed' });
    });
  });

  it('truncates a huge problem list to the byte limit', async () => {
    const ctx = ctxWith();
    await runFinishRun(
      notify,
      runContext(ctx, { problemsSoFar: Array.from({ length: 500 }, (_, i) => `problem ${i} é€`) }),
      settings,
    );
    const body = bodyOf(ctx);
    expect(Buffer.byteLength(body.message)).toBeLessThanOrEqual(4000);
  });
});
