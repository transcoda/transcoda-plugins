import { fakePluginContext } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { assertSecretHygiene } from './index.ts';

const KEY = 'SENTINEL-SECRET-9f3a';
const auth = { header: { name: 'X-Api-Key', value: KEY } };

function ctxWith(call: Record<string, unknown>, log?: string) {
  const ctx = fakePluginContext();
  ctx.calls.push({ url: 'http://service/api', method: 'GET', auth, ...call } as never);
  if (log !== undefined) ctx.logs.push(['info', log]);
  return ctx;
}

describe('assertSecretHygiene', () => {
  it('passes when the secret is only in auth', () => {
    assertSecretHygiene(ctxWith({}, 'asked the service'), KEY, [{ ok: true }, 'done'], { auth });
  });

  it.each([
    ['the url', ctxWith({ url: `http://service/api?key=${KEY}` }), []],
    ['a header', ctxWith({ headers: { 'X-Api-Key': KEY } }), []],
    ['the body', ctxWith({ body: { key: KEY } }), []],
    ['a log line', ctxWith({}, `failed with ${KEY}`), []],
    ['a result', ctxWith({}), [{ message: `bad key ${KEY}` }]],
    ['a message', ctxWith({}), [`bad key ${KEY}`]],
  ])('fails when the secret is in %s', (_where, ctx, outputs) => {
    expect(() => assertSecretHygiene(ctx, KEY, outputs)).toThrow();
  });

  it('fails when a call does not carry the expected auth', () => {
    expect(() =>
      assertSecretHygiene(ctxWith({ auth: { bearer: KEY } }), KEY, [], { auth }),
    ).toThrow();
  });

  it('fails when nothing was requested, unless told calls are optional', () => {
    const ctx = fakePluginContext();
    expect(() => assertSecretHygiene(ctx, KEY)).toThrow();
    assertSecretHygiene(ctx, KEY, [], { requireCalls: false });
  });

  it('checks every needle, and skips the url when the url is the secret', () => {
    const hook = `https://hooks.example/webhooks/${KEY}`;
    assertSecretHygiene(ctxWith({ url: hook }), [KEY, 'webhooks'], [], { secretInUrl: true });
    expect(() =>
      assertSecretHygiene(ctxWith({ url: hook }, 'posted to webhooks'), [KEY, 'webhooks'], [], {
        secretInUrl: true,
      }),
    ).toThrow();
  });
});
