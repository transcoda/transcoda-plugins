import { runTest } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { integration } from './integration.ts';
import { BASE, ctxWith, fixture } from './test-support.ts';

const STATUS = `${BASE}/api/v3/system/status`;
const CONFIG = `${BASE}/api/v3/config/mediamanagement`;

describe('radarr integration', () => {
  it('declares the integration', () => {
    expect(integration.id).toBe('radarr');
    expect(integration.title).toBe('Radarr');
    expect(integration.allowedOrigins).toEqual(['$settings.url']);
    expect(integration.requires).toEqual({ product: 'radarr', minVersion: '4.0.0' });
    expect(Object.keys(integration.settings.shape)).toEqual([
      'url',
      'apiKey',
      'pathMappings',
      'allowInsecureTls',
    ]);
  });

  it('is ok on a current Radarr, warning about unmonitoring when it is on', async () => {
    const config = {
      ...(fixture('radarr-mediamanagement') as object),
      autoUnmonitorPreviouslyDownloadedMovies: true,
    };
    const ctx = ctxWith([
      { match: { url: STATUS }, body: fixture('radarr-status') },
      { match: { url: CONFIG }, body: config },
    ]);
    const res = await runTest(integration, ctx);
    expect(res).toMatchObject({ ok: true, version: '5.20.0.9999' });
    expect(res.ok && res.warnings).toEqual([
      'Radarr unmonitors deleted movies: a rescan after a container change can leave a movie unmonitored',
    ]);
  });

  it('has no warnings when unmonitoring is off', async () => {
    const ctx = ctxWith([
      { match: { url: STATUS }, body: fixture('radarr-status') },
      { match: { url: CONFIG }, body: fixture('radarr-mediamanagement') },
    ]);
    const res = await runTest(integration, ctx);
    expect(res.ok).toBe(true);
    expect(res.ok && res.warnings).toBeUndefined();
    expect(ctx.logs).toEqual([]);
  });

  it('logs the keys at debug level when the field is missing', async () => {
    const ctx = ctxWith([
      { match: { url: STATUS }, body: fixture('radarr-status') },
      { match: { url: CONFIG }, body: { id: 1, recycleBin: '' } },
    ]);
    const res = await runTest(integration, ctx);
    expect(res.ok && res.warnings).toBeUndefined();
    expect(ctx.logs).toEqual([
      ['debug', 'unmonitor setting not found in mediamanagement; keys: id, recycleBin'],
    ]);
  });

  it('stays ok with a warning when the config cannot be read', async () => {
    const ctx = ctxWith([
      { match: { url: STATUS }, body: fixture('radarr-status') },
      { match: { url: CONFIG }, status: 403 },
    ]);
    const res = await runTest(integration, ctx);
    expect(res.ok && res.warnings).toEqual(['could not read media management settings: 403']);
  });

  it('stays ok with a warning when the config call fails to connect', async () => {
    const ctx = ctxWith([{ match: { url: STATUS }, body: fixture('radarr-status') }]);
    const res = await runTest(integration, ctx);
    expect(res.ok && res.warnings).toEqual(['could not read media management settings: failed']);
  });

  it('reports a rejected key', async () => {
    const ctx = ctxWith([{ match: { url: STATUS }, status: 401 }]);
    expect(await runTest(integration, ctx)).toEqual({
      ok: false,
      kind: 'unauthorized',
      message: 'Radarr rejected the API key',
    });
  });

  it('reports an unreachable server', async () => {
    const res = await runTest(integration, ctxWith([]));
    expect(res).toMatchObject({ ok: false, kind: 'unreachable' });
  });

  it('reports an unreachable server for a host-side error class (matched by kind)', async () => {
    const ctx = ctxWith([]);
    ctx.fetch = async () => {
      throw Object.assign(new Error('boom'), { kind: 'timeout' });
    };
    const res = await runTest(integration, ctx);
    expect(res).toEqual({
      ok: false,
      kind: 'unreachable',
      message: 'Radarr is not reachable at http://radarr:7878: timeout',
    });
  });

  it('reports the wrong product', async () => {
    const ctx = ctxWith([
      { match: { url: STATUS }, body: { appName: 'Sonarr', version: '4.0.0' } },
    ]);
    expect(await runTest(integration, ctx)).toMatchObject({ ok: false, kind: 'wrong-product' });
  });

  it('reports a too old Radarr', async () => {
    const ctx = ctxWith([
      { match: { url: STATUS }, body: { appName: 'Radarr', version: '3.2.2.5080' } },
    ]);
    expect(await runTest(integration, ctx)).toMatchObject({ ok: false, kind: 'too-old' });
  });
});
