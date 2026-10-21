import { describe, expect, it } from 'vitest';
import { BazarrHttpError, bazarrClient } from './client.ts';
import { BASE, ctxWith, SENTINEL, settings } from './test-util.ts';

describe('bazarr client', () => {
  it('authenticates through the structured header only', async () => {
    const ctx = ctxWith([{ match: { url: `${BASE}/api/system/status` }, body: { data: {} } }]);
    await bazarrClient(ctx).get('/api/system/status');
    const [call] = ctx.calls;
    expect(call?.auth).toEqual({ header: { name: 'X-API-KEY', value: SENTINEL } });
    expect(call?.url).not.toContain(SENTINEL);
    expect(call?.headers).toBeUndefined();
    expect(call?.timeoutMs).toBe(30_000);
  });

  it('writes array values as repeated key[]=v and encodes values', async () => {
    const ctx = ctxWith([{ match: { url: /.*/ }, body: {} }]);
    await bazarrClient(ctx).get('/api/episodes', { seriesid: ['1', '2'], q: 'a b&c' });
    expect(ctx.calls[0]?.url).toBe(`${BASE}/api/episodes?seriesid[]=1&seriesid[]=2&q=a%20b%26c`);
  });

  it('keeps a base path, drops trailing slashes and uses the timeout setting', async () => {
    const ctx = ctxWith([{ match: { url: /.*/ }, body: {} }], {
      settings: settings({ url: `${BASE}/bazarr//`, timeoutSeconds: 12 }),
    });
    await bazarrClient(ctx).get('/api/series', { start: '0' });
    expect(ctx.calls[0]?.url).toBe(`${BASE}/bazarr/api/series?start=0`);
    expect(ctx.calls[0]?.timeoutMs).toBe(12_000);
  });

  it('throws BazarrHttpError on a 4xx or 5xx GET', async () => {
    const ctx = ctxWith([{ match: { url: /.*/ }, status: 401 }]);
    await expect(bazarrClient(ctx).get('/api/series')).rejects.toMatchObject({
      name: 'BazarrHttpError',
      status: 401,
    });
    const err = new BazarrHttpError(500, '/api/series');
    expect(err.message).toBe('Bazarr answered 500 for /api/series');
  });

  it('patch returns the status, does not throw on 4xx and honours timeoutMs', async () => {
    const ctx = ctxWith([
      { match: { url: /.*/, method: 'PATCH' }, status: 204 },
      { match: { url: /.*/, method: 'PATCH' }, status: 404 },
    ]);
    const client = bazarrClient(ctx);
    expect(await client.patch('/api/series', { seriesid: '1', action: 'scan-disk' })).toBe(204);
    expect(await client.patch('/api/series', { seriesid: '1' }, { timeoutMs: 1234 })).toBe(404);
    expect(ctx.calls.map((c) => [c.method, c.url, c.timeoutMs])).toEqual([
      ['PATCH', `${BASE}/api/series?seriesid=1&action=scan-disk`, 30_000],
      ['PATCH', `${BASE}/api/series?seriesid=1`, 1234],
    ]);
  });
});
