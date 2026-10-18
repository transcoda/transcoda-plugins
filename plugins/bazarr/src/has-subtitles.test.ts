import { runData } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { hasSubtitles } from './has-subtitles.ts';
import {
  BASE,
  ctxWith,
  EPISODE_FILE,
  EPISODES_URL,
  fixture,
  hookContext,
  SERIES_URL,
} from './test-util.ts';

const found = () => [
  { match: { url: SERIES_URL }, body: fixture('series') },
  { match: { url: EPISODES_URL }, body: fixture('episodes') },
];
const UNKNOWN = { languages: 'unknown', forced: 'unknown', sdh: 'unknown' };

describe('bazarr:has-subtitles', () => {
  it('outputs languages, forced and SDH of the file', async () => {
    const ctx = ctxWith(found());
    const res = await runData(hasSubtitles, hookContext(ctx, EPISODE_FILE), {});
    expect(res).toEqual({
      value: { languages: ['deu', 'eng'], forced: true, sdh: false },
      reason: 'Example Show S01E03: deu, eng (forced)',
    });
  });

  it('include=external leaves out the embedded forced German track', async () => {
    const ctx = ctxWith(found());
    const res = await runData(hasSubtitles, hookContext(ctx, EPISODE_FILE), {
      include: 'external',
    });
    expect(res).toEqual({
      value: { languages: ['eng'], forced: false, sdh: false },
      reason: 'Example Show S01E03: eng',
    });
  });

  it('says so when a file has no subtitles', async () => {
    const ctx = ctxWith(found());
    const res = await runData(hasSubtitles, hookContext(ctx, EPISODE_FILE), {
      include: 'embedded',
    });
    expect(res.value).toEqual({ languages: ['deu'], forced: true, sdh: false });
    const ctx2 = ctxWith([
      { match: { url: SERIES_URL }, body: fixture('series') },
      {
        match: { url: EPISODES_URL },
        body: {
          data: [{ sonarrSeriesId: 1, sonarrEpisodeId: 11, path: EPISODE_FILE, subtitles: [] }],
        },
      },
    ]);
    const empty = await runData(hasSubtitles, hookContext(ctx2, EPISODE_FILE), {});
    expect(empty.value).toEqual({ languages: [], forced: false, sdh: false });
    expect(empty.reason).toMatch(/: no subtitles$/);
  });

  it('is unknown ×3 when Bazarr does not know the file', async () => {
    const ctx = ctxWith([
      { match: { url: SERIES_URL }, body: fixture('series') },
      { match: { url: `${BASE}/api/movies?start=0&length=-1` }, body: { data: [], total: 0 } },
    ]);
    const res = await runData(hasSubtitles, hookContext(ctx, '/data/shows/Elsewhere/a.mkv'), {});
    expect(res).toEqual({
      value: UNKNOWN,
      reason: 'Bazarr does not know /data/shows/Elsewhere/a.mkv',
    });
  });

  it('reports the remote path in the reason when mappings apply', async () => {
    const ctx = ctxWith(
      [
        { match: { url: SERIES_URL }, body: { data: [], total: 0 } },
        { match: { url: `${BASE}/api/movies?start=0&length=-1` }, body: { data: [], total: 0 } },
      ],
      { mappings: [{ remote: '/tv', local: '/data/shows' }] },
    );
    const res = await runData(hasSubtitles, hookContext(ctx, '/data/shows/x/a.mkv'), {});
    expect(res.reason).toBe('Bazarr does not know /tv/x/a.mkv');
  });

  it('is unknown ×3 and never throws when Bazarr is unreachable', async () => {
    const ctx = ctxWith([]);
    const res = await runData(hasSubtitles, hookContext(ctx, EPISODE_FILE), {});
    expect(res).toEqual({ value: UNKNOWN, reason: 'Bazarr unreachable: failed' });
  });

  it('reports a Bazarr HTTP error by its message', async () => {
    const ctx = ctxWith([{ match: { url: SERIES_URL }, status: 401 }]);
    const res = await runData(hasSubtitles, hookContext(ctx, EPISODE_FILE), {});
    expect(res).toEqual({
      value: UNKNOWN,
      reason: 'Bazarr answered 401 for /api/series',
    });
  });
});
