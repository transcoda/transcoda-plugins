import { fakePluginContext } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { BASE, jellyfinFixture, KEY, settings } from '../test/fixtures.ts';
import { jellyfinAuth, jellyfinGet } from './auth.ts';

const info = jellyfinFixture('system-info');
const url = `${BASE}/System/Info`;

describe('jellyfinGet', () => {
  it('sends the MediaBrowser header through auth first, key nowhere else', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [{ match: { url }, body: info }],
    });
    const res = await jellyfinGet(ctx, '/System/Info');
    expect(res.status).toBe(200);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]?.auth).toEqual({
      header: { name: 'Authorization', value: `MediaBrowser Token="${KEY}"` },
    });
    expect(ctx.calls[0]?.headers).toBeUndefined();
  });

  it('falls back to X-Emby-Token on 401, warns once and remembers it', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        { match: { url }, status: 401 },
        { match: { url }, body: info },
        { match: { url }, body: info },
      ],
    });
    expect((await jellyfinGet(ctx, '/System/Info')).status).toBe(200);
    expect((await jellyfinGet(ctx, '/System/Info')).status).toBe(200);
    expect(ctx.calls.map((c) => c.auth)).toEqual([
      { header: { name: 'Authorization', value: `MediaBrowser Token="${KEY}"` } },
      { header: { name: 'X-Emby-Token', value: KEY } },
      { header: { name: 'X-Emby-Token', value: KEY } },
    ]);
    expect(ctx.logs.filter(([l]) => l === 'warn')).toEqual([
      ['warn', 'Jellyfin accepted only the legacy X-Emby-Token header'],
    ]);
  });

  it('returns the 401 when both headers are refused and caches nothing', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        { match: { url }, status: 401 },
        { match: { url }, status: 401 },
        { match: { url }, status: 401 },
        { match: { url }, status: 401 },
      ],
    });
    expect((await jellyfinGet(ctx, '/System/Info')).status).toBe(401);
    expect(ctx.logs).toEqual([]);
    expect((await jellyfinGet(ctx, '/System/Info')).status).toBe(401);
    // the second call again starts with the default header
    expect(ctx.calls[2]?.auth).toEqual(ctx.calls[0]?.auth);
  });

  it('builds both header forms', () => {
    const ctx = fakePluginContext({ settings });
    expect(jellyfinAuth(ctx, 'emby')).toEqual({ header: { name: 'X-Emby-Token', value: KEY } });
  });

  it('does not cache the emby header when the retry answers an error', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        { match: { url }, status: 401 },
        { match: { url }, status: 500 },
        { match: { url }, status: 200, body: info },
      ],
    });
    expect((await jellyfinGet(ctx, '/System/Info')).status).toBe(500);
    expect(ctx.logs).toEqual([]);
    await jellyfinGet(ctx, '/System/Info');
    expect(ctx.calls[2]?.auth).toEqual(ctx.calls[0]?.auth);
  });

  it('does not retry again once emby is cached and still answers 401', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [
        { match: { url }, status: 401 },
        { match: { url }, body: info },
        { match: { url }, status: 401 },
      ],
    });
    await jellyfinGet(ctx, '/System/Info');
    expect((await jellyfinGet(ctx, '/System/Info')).status).toBe(401);
    expect(ctx.calls).toHaveLength(3);
  });
});
