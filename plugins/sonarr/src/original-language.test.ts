import { fakeHookContext, fakePluginContext, runData } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { originalLanguage } from './original-language.ts';
import { BASE, get, SHOW, settings } from './test-util.ts';

const dataCtx = (plugin: ReturnType<typeof fakePluginContext>, path = '/data/shows/Show/a.mkv') =>
  fakeHookContext({
    plugin,
    file: { path, sizeBytes: 1, mtime: '2026-10-17T00:00:00.000Z', nlink: 1 },
  });

const withLang = (name: string) => ({
  ...SHOW,
  tvdbId: 1,
  tmdbId: 2,
  imdbId: '',
  originalLanguage: { id: 8, name },
});

describe('sonarr:original-language', () => {
  it('outputs language, title and ids', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [get('/api/v3/series', [withLang('Japanese')])],
    });
    const r = await runData(originalLanguage, dataCtx(ctx), {});
    expect(r.value).toEqual({
      language: 'jpn',
      title: 'Show',
      ids: { tvdbId: 1, tmdbId: 2 },
    });
    expect(r.reason).toContain('Japanese');
    expect(ctx.calls.map((c) => c.url)).toEqual([`${BASE}/api/v3/series`]);
  });

  it('outputs unknown for an Unknown language but keeps title and ids', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [get('/api/v3/series', [withLang('Unknown')])],
    });
    const r = await runData(originalLanguage, dataCtx(ctx), {});
    expect(r.value).toMatchObject({ language: 'unknown', title: 'Show' });
  });

  it('outputs unknown on every port when Sonarr does not know the path', async () => {
    const ctx = fakePluginContext({ settings, responses: [get('/api/v3/series', [])] });
    const r = await runData(originalLanguage, dataCtx(ctx), {});
    expect(r).toEqual({
      value: { language: 'unknown', title: 'unknown', ids: 'unknown' },
      reason: 'Sonarr does not know /data/shows/Show/a.mkv',
    });
  });

  it('uses the remote path in the reason', async () => {
    const ctx = fakePluginContext({
      settings,
      mappings: [{ remote: '/tv', local: '/data/shows' }],
      responses: [get('/api/v3/series', [])],
    });
    const r = await runData(originalLanguage, dataCtx(ctx), {});
    expect(r.reason).toBe('Sonarr does not know /tv/Show/a.mkv');
  });

  it('reports an unreachable Sonarr as a reason, never a throw', async () => {
    const ctx = fakePluginContext({ settings });
    const r = await runData(originalLanguage, dataCtx(ctx), {});
    expect(r).toEqual({
      value: { language: 'unknown', title: 'unknown', ids: 'unknown' },
      reason: 'Sonarr unreachable: failed',
    });
    expect(ctx.calls[0]?.url).toBe(`${BASE}/api/v3/series`);
  });

  it('classifies a kind-tagged error from another SDK copy', async () => {
    const ctx = fakePluginContext({ settings });
    ctx.fetch = async () => {
      throw Object.assign(new Error('x'), { kind: 'timeout' });
    };
    const r = await runData(originalLanguage, dataCtx(ctx), {});
    expect(r.reason).toBe('Sonarr unreachable: timeout');
  });

  it('reports an HTTP error as a reason', async () => {
    const ctx = fakePluginContext({ settings, responses: [get('/api/v3/series', null, 401)] });
    const r = await runData(originalLanguage, dataCtx(ctx), {});
    expect(r.reason).toBe('Sonarr answered 401 for /api/v3/series');
  });
});
