import { fakePluginContext } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { ArrHttpError, arrBaseUrl, arrClient, arrGet, arrPost } from './index.ts';

const SECRET = 'SENTINEL-SECRET-9f3a';
const settings = { url: 'http://nas:8989/sonarr/', apiKey: SECRET };

describe('arrBaseUrl', () => {
  it('strips many trailing slashes quickly and keeps inner ones', () => {
    const many = `http://nas:8989/${'/'.repeat(100_000)}x`;
    const started = Date.now();
    expect(arrBaseUrl({ url: many })).toBe(many);
    expect(arrBaseUrl({ url: `http://nas:8989/sonarr${'/'.repeat(100_000)}` })).toBe(
      'http://nas:8989/sonarr',
    );
    expect(Date.now() - started).toBeLessThan(500);
  });
  it('strips trailing slashes and keeps a base path', () => {
    expect(arrBaseUrl({ url: 'http://nas:8989/' })).toBe('http://nas:8989');
    expect(arrBaseUrl({ url: 'http://nas:8989/sonarr/' })).toBe('http://nas:8989/sonarr');
    expect(arrBaseUrl({ url: 'http://nas:8989/sonarr' })).toBe('http://nas:8989/sonarr');
  });
});

describe('arr client', () => {
  it('sends the key through auth.header only', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [{ match: { url: 'http://nas:8989/sonarr/api/v3/series' }, body: [] }],
    });
    expect(await arrGet(ctx, '/api/v3/series')).toEqual([]);
    const [call] = ctx.calls;
    expect(call?.auth).toEqual({ header: { name: 'X-Api-Key', value: SECRET } });
    expect(call?.headers).toBeUndefined();
    expect(call?.accept).toBe('json');
    expect(JSON.stringify({ ...call, auth: undefined })).not.toContain(SECRET);
    expect(call?.url).not.toMatch(/apikey/i);
  });

  it('posts a JSON body', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [{ match: { url: /command$/, method: 'POST' }, body: { id: 1 } }],
    });
    expect(await arrPost(ctx, '/api/v3/command', { name: 'X' })).toEqual({ id: 1 });
    expect(ctx.calls[0]?.method).toBe('POST');
    expect(ctx.calls[0]?.body).toEqual({ name: 'X' });
  });

  it('throws ArrHttpError with the product, status and path, without the key', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [{ match: { url: /system\/status$/ }, status: 401, body: null }],
    });
    const err = await arrClient(ctx, 'Sonarr')
      .get('/api/v3/system/status')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArrHttpError);
    expect((err as ArrHttpError).status).toBe(401);
    expect((err as ArrHttpError).path).toBe('/api/v3/system/status');
    expect((err as Error).message).toBe('Sonarr answered 401 for /api/v3/system/status');
  });
});
