import { integrationMetadata } from '@transcoda/sdk';
import { fakePluginContext, runTest } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { integration } from './integration.ts';
import { fixture, get, settings } from './test-util.ts';

const STATUS = '/api/v1/status';
const ME = '/api/v1/auth/me';

describe('seerr integration', () => {
  it('declares its metadata', () => {
    expect(integrationMetadata(integration)).toMatchObject({
      id: 'seerr',
      title: 'Seerr (Jellyseerr, Overseerr)',
      allowedOrigins: ['$settings.url'],
    });
  });

  it('is ok with the version and origin', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [get(STATUS, fixture('status')), get(ME, fixture('auth-me'))],
    });
    expect(await runTest(integration, ctx)).toEqual({
      ok: true,
      message: 'Seerr 3.5.0 at http://192.0.2.20:5055',
      version: '3.5.0',
    });
  });

  it('is unreachable when the status call cannot connect', async () => {
    const r = await runTest(integration, fakePluginContext({ settings }));
    expect(r).toMatchObject({ ok: false, kind: 'unreachable' });
  });

  it('is wrong-product when the address does not answer like Seerr', async () => {
    for (const body of [{ appName: 'Sonarr' }, 'hello', null]) {
      const r = await runTest(
        integration,
        fakePluginContext({ settings, responses: [get(STATUS, body)] }),
      );
      expect(r).toEqual({
        ok: false,
        kind: 'wrong-product',
        message: 'the address answered, but it is not Jellyseerr or Overseerr',
      });
    }
    const notFound = await runTest(
      integration,
      fakePluginContext({ settings, responses: [get(STATUS, null, 404)] }),
    );
    expect(notFound).toMatchObject({ ok: false, kind: 'wrong-product' });
  });

  it('a 5xx on status is other, not wrong-product', async () => {
    const r = await runTest(
      integration,
      fakePluginContext({ settings, responses: [get(STATUS, null, 503)] }),
    );
    expect(r).toEqual({ ok: false, kind: 'other', message: 'Seerr answered HTTP 503' });
  });

  it('is unauthorized when the key is rejected', async () => {
    for (const status of [401, 403]) {
      const ctx = fakePluginContext({
        settings,
        responses: [get(STATUS, fixture('status')), get(ME, null, status)],
      });
      expect(await runTest(integration, ctx)).toEqual({
        ok: false,
        kind: 'unauthorized',
        message: 'Seerr rejected the API key',
      });
    }
  });

  it('reports other failures of the user call', async () => {
    const http = fakePluginContext({
      settings,
      responses: [get(STATUS, fixture('status')), get(ME, null, 500)],
    });
    expect(await runTest(integration, http)).toMatchObject({ ok: false, kind: 'other' });
    const dropped = fakePluginContext({ settings, responses: [get(STATUS, fixture('status'))] });
    expect(await runTest(integration, dropped)).toMatchObject({ ok: false, kind: 'unreachable' });
  });
});
