import { FetchTimeout, integrationMetadata } from '@transcoda/sdk';
import { fakePluginContext, runTest } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { BASE, jellyfinFixture, settings } from '../test/fixtures.ts';
import { DEFAULT_MAPPINGS, integration } from './integration.ts';

const pub = jellyfinFixture('system-info-public');
const info = jellyfinFixture('system-info');
const PUBLIC = { match: { url: `${BASE}/System/Info/Public` } };
const INFO = { match: { url: `${BASE}/System/Info` } };

describe('jellyfin integration test()', () => {
  it('reports the version and server name', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        { ...PUBLIC, body: pub },
        { ...INFO, body: info },
      ],
    });
    expect(await runTest(integration, ctx)).toEqual({
      ok: true,
      message: 'Jellyfin 12.2.0 (Example Jellyfin)',
      version: '12.2.0',
      warnings: [],
    });
    expect(ctx.calls[0]?.auth).toBeUndefined();
  });

  it('adds a warning when only the legacy header worked', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        { ...PUBLIC, body: pub },
        { ...INFO, status: 401 },
        { ...INFO, body: info },
      ],
    });
    const res = await runTest(integration, ctx);
    expect(res).toMatchObject({
      ok: true,
      warnings: ['Jellyfin accepted only the legacy X-Emby-Token header'],
    });
  });

  it('is unreachable on a fetch error', async () => {
    const ctx = fakePluginContext({ settings, responses: [] });
    expect(await runTest(integration, ctx)).toEqual({
      ok: false,
      kind: 'unreachable',
      message: 'Jellyfin is not reachable at http://jellyfin:8096: failed',
    });
    const timeout = fakePluginContext({ settings });
    timeout.fetch = async () => {
      throw new FetchTimeout('slow');
    };
    expect(await runTest(integration, timeout)).toMatchObject({
      kind: 'unreachable',
      message: expect.stringContaining('timeout'),
    });
  });

  it('is other on a non-200 public answer', async () => {
    const ctx = fakePluginContext({ settings, responses: [{ ...PUBLIC, status: 502 }] });
    expect(await runTest(integration, ctx)).toMatchObject({ ok: false, kind: 'other' });
  });

  it('is wrong-product when the public answer has no Version', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [{ ...PUBLIC, body: { hello: 'world' } }],
    });
    expect(await runTest(integration, ctx)).toEqual({
      ok: false,
      kind: 'wrong-product',
      message: 'The server at http://jellyfin:8096 does not look like Jellyfin',
    });
  });

  it('is unauthorized when both headers get 401', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        { ...PUBLIC, body: pub },
        { ...INFO, status: 401 },
        { ...INFO, status: 401 },
      ],
    });
    expect(await runTest(integration, ctx)).toEqual({
      ok: false,
      kind: 'unauthorized',
      message: 'Jellyfin rejected the API key',
    });
  });

  it('declares the origin, secret and product requirement', () => {
    expect(integration.allowedOrigins).toEqual(['$settings.url']);
    expect(integration.requires).toEqual({ product: 'jellyfin', minVersion: '10.8.0' });
  });

  it('defaults the path mappings to the /data/shows and /data/movies layout', () => {
    const parsed = integration.settings.parse({ url: BASE, apiKey: 'k' });
    expect(parsed.pathMappings).toEqual([
      { local: '/data/shows', remote: '/shows' },
      { local: '/data/movies', remote: '/movies' },
    ]);
    expect(DEFAULT_MAPPINGS).toHaveLength(2);
    const props = (
      integrationMetadata(integration).settingsSchema as {
        properties: Record<string, Record<string, unknown>>;
      }
    ).properties;
    expect(props.pathMappings?.['x-transcoda']).toBe('path-mappings');
    expect(props.pathMappings?.default).toEqual(DEFAULT_MAPPINGS);
  });

  it('falls back to the Public answer for version and name', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        { ...PUBLIC, body: pub },
        { ...INFO, body: { ProductName: 'Jellyfin Server' } },
      ],
    });
    expect(await runTest(integration, ctx)).toMatchObject({
      ok: true,
      message: 'Jellyfin 12.2.0 (Example Jellyfin)',
      version: '12.2.0',
    });
  });

  it('treats 403 from /System/Info as unauthorized', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        { ...PUBLIC, body: pub },
        { ...INFO, status: 403 },
      ],
    });
    expect(await runTest(integration, ctx)).toMatchObject({ ok: false, kind: 'unauthorized' });
  });

  it('reports another non-200 from /System/Info as other', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        { ...PUBLIC, body: pub },
        { ...INFO, status: 500 },
      ],
    });
    expect(await runTest(integration, ctx)).toEqual({
      ok: false,
      kind: 'other',
      message: 'Jellyfin answered 500 to the system info request',
    });
  });
});
