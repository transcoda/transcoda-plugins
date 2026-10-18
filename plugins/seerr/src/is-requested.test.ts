import { runDecide } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { isRequested } from './is-requested.ts';
import { dataCtx, fixture, get, withSettings } from './test-util.ts';

describe('seerr:is-requested', () => {
  it('declares a file input and Yes / No ports', () => {
    expect(isRequested.kind).toBe('condition');
    expect(isRequested.inputs.map((i) => i.id)).toEqual(['file', 'ids', 'title']);
    expect(isRequested.outputs.map((o) => [o.id, o.label])).toEqual([
      ['pass', 'Yes'],
      ['else', 'No'],
    ]);
  });

  it('requested goes to pass with findings', async () => {
    const plugin = withSettings([get('/api/v1/movie/900001', fixture('movie-requested'))]);
    const r = await runDecide(isRequested, dataCtx(plugin, { ids: { tmdbId: 900001 } }), {});
    expect(r).toEqual({
      port: 'pass',
      reason: 'Example Movie: requested by Alex on 2026-09-01',
      findings: { requestedBy: 'Alex', requestedAt: '2026-09-01T10:00:00.000Z' },
    });
  });

  it('not requested goes to else', async () => {
    const plugin = withSettings([get('/api/v1/movie/900002', fixture('movie-unrequested'))]);
    const r = await runDecide(isRequested, dataCtx(plugin, { ids: { tmdbId: 900002 } }), {});
    expect(r).toMatchObject({ port: 'else', reason: 'Example Movie Two: not requested in Seerr' });
  });

  it('unknown goes to else, or to pass with whenUnknown yes', async () => {
    const no = await runDecide(isRequested, dataCtx(withSettings([]), {}), {});
    expect(no).toEqual({
      port: 'else',
      reason: 'connect ids or a title (from Sonarr, Radarr or TMDB)',
    });
    const yes = await runDecide(isRequested, dataCtx(withSettings([]), {}), {
      whenUnknown: 'yes',
    });
    expect(yes).toMatchObject({
      port: 'pass',
      reason: 'connect ids or a title (from Sonarr, Radarr or TMDB)',
    });
  });

  it('defaults: kind auto, whenUnknown no', () => {
    expect(isRequested.settings.parse({})).toEqual({ kind: 'auto', whenUnknown: 'no' });
  });
});
