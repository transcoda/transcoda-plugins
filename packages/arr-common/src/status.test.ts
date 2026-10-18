import { fakePluginContext } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { arrFixture } from '../test/fixtures.ts';
import { testStatus } from './index.ts';

const settings = { url: 'http://nas:8989', apiKey: 'SENTINEL-SECRET-9f3a' };
const status = arrFixture('sonarr-status') as Record<string, string>;
const ctxWith = (body: unknown, code = 200) =>
  fakePluginContext({
    settings,
    responses: [
      { match: { url: 'http://nas:8989/api/v3/system/status' }, status: code, body: body as never },
    ],
  });

describe('testStatus', () => {
  it('passes on the right product and version', async () => {
    expect(await testStatus(ctxWith(status), 'Sonarr', 4)).toEqual({
      ok: true,
      message: 'Sonarr 4.0.20.1000 at http://nas:8989',
      version: '4.0.20.1000',
    });
  });
  it('detects the wrong product', async () => {
    const r = await testStatus(ctxWith({ ...status, appName: 'Radarr' }), 'Sonarr', 4);
    expect(r).toMatchObject({ ok: false, kind: 'wrong-product' });
  });
  it('detects an old version', async () => {
    const r = await testStatus(ctxWith({ ...status, version: '3.0.10' }), 'Sonarr', 4);
    expect(r).toEqual({
      ok: false,
      kind: 'too-old',
      message: 'Sonarr 3.0.10 is too old; 4.0 or newer is required',
    });
  });
  it('maps a fetch failure to unreachable', async () => {
    const r = await testStatus(fakePluginContext({ settings }), 'Sonarr', 4);
    expect(r).toEqual({
      ok: false,
      kind: 'unreachable',
      message: 'Sonarr is not reachable at http://nas:8989: failed',
    });
  });
  it('maps 401 and 403 to unauthorized without the key', async () => {
    for (const code of [401, 403]) {
      const r = await testStatus(ctxWith(null, code), 'Radarr', 5);
      expect(r).toEqual({
        ok: false,
        kind: 'unauthorized',
        message: 'Radarr rejected the API key',
      });
    }
  });
  it('maps other HTTP errors to other', async () => {
    const r = await testStatus(ctxWith(null, 500), 'Sonarr', 4);
    expect(r).toMatchObject({ ok: false, kind: 'other' });
  });
  it('maps a rate-limited fetch to other', async () => {
    const ctx = fakePluginContext({ settings });
    ctx.fetch = async () => {
      throw Object.assign(new Error('slow down'), { kind: 'rate-limited' });
    };
    expect(await testStatus(ctx, 'Sonarr', 4)).toEqual({
      ok: false,
      kind: 'other',
      message: 'Sonarr is rate limiting requests',
    });
  });
  it('maps a kind-tagged timeout from another SDK copy to unreachable', async () => {
    const ctx = fakePluginContext({ settings });
    ctx.fetch = async () => {
      throw Object.assign(new Error('slow'), { kind: 'timeout' });
    };
    expect(await testStatus(ctx, 'Sonarr', 4)).toEqual({
      ok: false,
      kind: 'unreachable',
      message: 'Sonarr is not reachable at http://nas:8989: timeout',
    });
  });
  it('never puts the key in a failure message', async () => {
    const results = [
      await testStatus(fakePluginContext({ settings }), 'Sonarr', 4),
      await testStatus(ctxWith(null, 401), 'Sonarr', 4),
      await testStatus(ctxWith(null, 500), 'Sonarr', 4),
      await testStatus(ctxWith({ ...status, appName: 'Radarr' }), 'Sonarr', 4),
      await testStatus(ctxWith({ ...status, version: '3.0.1' }), 'Sonarr', 4),
    ];
    for (const r of results) expect(JSON.stringify(r)).not.toContain(settings.apiKey);
  });
});
