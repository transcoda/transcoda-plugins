import { runDecide } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { subtitlesPresent } from './subtitles-present.ts';
import {
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

describe('bazarr:subtitles-present', () => {
  it('passes when every chosen language is listed', async () => {
    const ctx = ctxWith(found());
    const res = await runDecide(subtitlesPresent, hookContext(ctx, EPISODE_FILE), {
      languages: ['eng'],
    });
    expect(res).toEqual({ port: 'pass', reason: 'Bazarr has eng' });
  });

  it('passes for several languages, in the order chosen', async () => {
    const ctx = ctxWith(found());
    const res = await runDecide(subtitlesPresent, hookContext(ctx, EPISODE_FILE), {
      languages: ['deu', 'eng'],
    });
    expect(res).toEqual({ port: 'pass', reason: 'Bazarr has deu, eng' });
  });

  it('goes to else naming the missing language', async () => {
    const ctx = ctxWith(found());
    const res = await runDecide(subtitlesPresent, hookContext(ctx, EPISODE_FILE), {
      languages: ['eng', 'fra'],
    });
    expect(res).toEqual({ port: 'else', reason: 'Bazarr has no fra subtitle' });
  });

  it('respects include: the German track is embedded', async () => {
    const ctx = ctxWith(found());
    const res = await runDecide(subtitlesPresent, hookContext(ctx, EPISODE_FILE), {
      languages: ['deu'],
      include: 'external',
    });
    expect(res.port).toBe('else');
  });

  it('goes to else when Bazarr does not know the file', async () => {
    const ctx = ctxWith([
      { match: { url: SERIES_URL }, body: { data: [], total: 0 } },
      { match: { url: /movies\?start/ }, body: { data: [], total: 0 } },
    ]);
    const res = await runDecide(subtitlesPresent, hookContext(ctx, '/data/x/a.mkv'), {
      languages: ['eng'],
    });
    expect(res).toEqual({ port: 'else', reason: 'Bazarr does not know /data/x/a.mkv' });
  });

  it('goes to else when Bazarr is unreachable', async () => {
    const ctx = ctxWith([]);
    const res = await runDecide(subtitlesPresent, hookContext(ctx, EPISODE_FILE), {
      languages: ['eng'],
    });
    expect(res).toEqual({ port: 'else', reason: 'Bazarr unreachable: failed' });
  });

  it('rejects a language that is not a three-letter code', () => {
    expect(subtitlesPresent.settings.safeParse({ languages: ['en'] }).success).toBe(false);
    expect(subtitlesPresent.settings.safeParse({ languages: [] }).success).toBe(false);
  });
});
