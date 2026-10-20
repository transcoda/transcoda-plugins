import { integrationMetadata } from '@transcoda/sdk';
import { fakePluginContext, runTest } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { integration } from './integration.ts';
import { arrFixture, get, settings } from './test-util.ts';

const status = arrFixture('sonarr-status') as Record<string, unknown>;
const mm = arrFixture('sonarr-mediamanagement') as Record<string, unknown>;
const STATUS = '/api/v3/system/status';
const MM = '/api/v3/config/mediamanagement';

describe('sonarr integration', () => {
  it('declares its metadata', () => {
    const meta = integrationMetadata(integration);
    expect(meta).toMatchObject({
      id: 'sonarr',
      title: 'Sonarr',
      allowedOrigins: ['$settings.url'],
      requires: { product: 'sonarr', minVersion: '4.0.0' },
    });
  });

  it('passes with no warnings when deleted episodes are not unmonitored', async () => {
    const ctx = fakePluginContext({ settings, responses: [get(STATUS, status), get(MM, mm)] });
    const r = await runTest(integration, ctx);
    expect(r).toEqual({
      ok: true,
      message: 'Sonarr 4.0.20.1000 at http://nas:8989',
      version: '4.0.20.1000',
    });
    expect(r).not.toHaveProperty('warnings');
  });

  it('warns when Sonarr unmonitors previously downloaded episodes', async () => {
    const on = { ...mm, autoUnmonitorPreviouslyDownloadedEpisodes: true };
    const ctx = fakePluginContext({ settings, responses: [get(STATUS, status), get(MM, on)] });
    const r = await runTest(integration, ctx);
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.warnings).toHaveLength(1);
    expect(r.ok && r.warnings?.[0]).toContain('unmonitors deleted episodes');
  });

  it('logs the keys at debug level when the setting is not found', async () => {
    const { autoUnmonitorPreviouslyDownloadedEpisodes: _gone, ...rest } = mm;
    const ctx = fakePluginContext({ settings, responses: [get(STATUS, status), get(MM, rest)] });
    const r = await runTest(integration, ctx);
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.warnings).toBeUndefined();
    const line = ctx.logs.find(([lvl, m]) => lvl === 'debug' && m.startsWith('unmonitor setting'));
    expect(line?.[1]).toContain('keys: ');
    expect(line?.[1]).toContain('recycleBin');
  });

  it('stays ok with a warning when media management cannot be read', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [get(STATUS, status), get(MM, null, 500)],
    });
    const r = await runTest(integration, ctx);
    expect(r).toMatchObject({
      ok: true,
      warnings: ['could not read media management settings: 500'],
    });
  });

  it('stays ok with a warning when the second call fails to connect', async () => {
    const ctx = fakePluginContext({ settings, responses: [get(STATUS, status)] });
    const r = await runTest(integration, ctx);
    expect(r).toMatchObject({
      ok: true,
      warnings: ['could not read media management settings: failed'],
    });
  });

  it('classifies a kind-tagged error from another SDK copy', async () => {
    const ctx = fakePluginContext({ settings, responses: [get(STATUS, status)] });
    const real = ctx.fetch;
    ctx.fetch = async (input) => {
      if (input.url.endsWith(MM)) throw Object.assign(new Error('x'), { kind: 'timeout' });
      return real(input);
    };
    expect(await runTest(integration, ctx)).toMatchObject({
      ok: true,
      warnings: ['could not read media management settings: timeout'],
    });
  });

  it('wrong product, unauthorized, too old and unreachable come from the shared test', async () => {
    const wrong = fakePluginContext({
      settings,
      responses: [get(STATUS, { ...status, appName: 'Radarr' })],
    });
    expect(await runTest(integration, wrong)).toMatchObject({ ok: false, kind: 'wrong-product' });
    const unauth = fakePluginContext({ settings, responses: [get(STATUS, null, 401)] });
    expect(await runTest(integration, unauth)).toMatchObject({ ok: false, kind: 'unauthorized' });
    const old = fakePluginContext({
      settings,
      responses: [get(STATUS, { ...status, version: '3.0.10.1' })],
    });
    expect(await runTest(integration, old)).toMatchObject({ ok: false, kind: 'too-old' });
    const down = fakePluginContext({ settings });
    expect(await runTest(integration, down)).toMatchObject({ ok: false, kind: 'unreachable' });
  });
});
