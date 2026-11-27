import { assertSecretHygiene } from '@transcoda/plugin-test-utils';
import { runFinish, runFinishRun, runTest } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { hooks, integration, notify } from './index.ts';
import { ctxWith, job, publishOk, runContext, SENTINEL, timingOut } from './test-util.ts';

const health = (status: number) => ({
  match: { url: 'https://ntfy.example/v1/health' },
  status,
  body: {},
});

// The finish hook and some failures make no request at all, so calls are not required.
const assertClean = (ctx: ReturnType<typeof ctxWith>, texts: string[], thrown: string[] = []) =>
  assertSecretHygiene(ctx, SENTINEL, [...texts, ...thrown], { requireCalls: false });

describe('secret hygiene (token only ever in auth.bearer)', () => {
  const withToken = { token: SENTINEL, notifyOnFailed: true };

  it('keeps the token in auth on a successful publish', async () => {
    const ctx = ctxWith(withToken);
    const res = await runFinishRun(notify, runContext(ctx), { topic: 'media' });
    assertClean(ctx, [res.message]);
    expect(ctx.calls[0]?.auth).toEqual({ bearer: SENTINEL });
  });

  it.each([401, 403, 413, 500])('keeps the token out of the %i message', async (status) => {
    const ctx = ctxWith(withToken, [publishOk(status)]);
    const res = await runFinishRun(notify, runContext(ctx), { topic: 'media' });
    assertClean(ctx, [res.message]);
  });

  it('keeps the token out of timeout and refused messages', async () => {
    const a = timingOut(withToken);
    const ra = await runFinishRun(notify, runContext(a), { topic: 'media' });
    assertClean(a, [ra.message]);
    const b = ctxWith(withToken, []);
    const rb = await runFinishRun(notify, runContext(b), { topic: 'media' });
    assertClean(b, [rb.message]);
  });

  it('keeps the token out of the finish hook result', async () => {
    const ctx = ctxWith(withToken);
    const res = await runFinish(
      notify,
      { ...runContext(ctx), model: undefined as never },
      { topic: 'media' },
    );
    assertClean(ctx, [JSON.stringify(res)]);
  });

  it('keeps the token out of test() results', async () => {
    for (const responses of [[health(200)], [health(401)], []]) {
      const ctx = ctxWith(withToken, responses);
      const res = await runTest(integration, ctx);
      assertClean(ctx, [res.message]);
    }
  });

  it('keeps the token out of onJobFailed calls and errors', async () => {
    const ok = ctxWith(withToken);
    await hooks.onJobFailed?.(ok, job);
    assertClean(ok, []);
    for (const status of [401, 413, 500]) {
      const ctx = ctxWith(withToken, [publishOk(status)]);
      const error = await hooks.onJobFailed?.(ctx, job).then(
        () => '',
        (e: Error) => e.message,
      );
      assertClean(ctx, [], [error ?? '']);
    }
    const t = timingOut(withToken);
    const error = await hooks.onJobFailed?.(t, job).then(
      () => '',
      (e: Error) => e.message,
    );
    assertClean(t, [], [error ?? '']);
  });
});
