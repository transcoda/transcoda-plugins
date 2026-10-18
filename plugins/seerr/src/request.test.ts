import { runData } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { request } from './request.ts';
import { dataCtx, fixture, get, withSettings } from './test-util.ts';

describe('seerr:request', () => {
  it('declares its ports and a kind setting', () => {
    expect(request.outputs.map((o) => o.id)).toEqual(['requested', 'requestedBy', 'requestedAt']);
    expect(request.inputs.map((i) => [i.id, i.required])).toEqual([
      ['ids', false],
      ['title', false],
    ]);
    expect(request.settings.parse({})).toEqual({ kind: 'auto' });
  });

  it('outputs the three values and the reason', async () => {
    const plugin = withSettings([get('/api/v1/movie/900001', fixture('movie-requested'))]);
    const r = await runData(request, dataCtx(plugin, { ids: { tmdbId: 900001 } }), {});
    expect(r.value).toEqual({
      requested: true,
      requestedBy: 'Alex',
      requestedAt: '2026-09-01T10:00:00.000Z',
    });
    expect(r.reason).toBe('Example Movie: requested by Alex on 2026-09-01');
  });

  it('outputs unknown on every port with nothing to look up', async () => {
    const r = await runData(request, dataCtx(withSettings([]), {}), {});
    expect(r.value).toEqual({
      requested: 'unknown',
      requestedBy: 'unknown',
      requestedAt: 'unknown',
    });
  });

  it('passes the kind setting through', async () => {
    const plugin = withSettings([get('/api/v1/tv/900100', fixture('tv-requested'))]);
    const r = await runData(request, dataCtx(plugin, { ids: { tmdbId: 900100 } }), { kind: 'tv' });
    expect(r.value).toMatchObject({ requested: true });
  });
});
