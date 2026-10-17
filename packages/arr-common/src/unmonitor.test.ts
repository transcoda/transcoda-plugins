import { describe, expect, it } from 'vitest';
import { arrFixture } from './fixtures.ts';
import { unmonitorWarning } from './index.ts';

const sonarr = arrFixture('sonarr-mediamanagement') as Record<string, never>;
const FIELD = 'autoUnmonitorPreviouslyDownloadedEpisodes';

describe('unmonitorWarning', () => {
  it('warns when the field is true', () => {
    expect(unmonitorWarning({ ...sonarr, [FIELD]: true }, 'episodes')).toEqual({
      warning:
        'Sonarr unmonitors deleted episodes: a rescan after a container change can leave an episode unmonitored',
      fieldSeen: FIELD,
    });
    expect(
      unmonitorWarning({ autoUnmonitorPreviouslyDownloadedMovies: true }, 'movies').warning,
    ).toBe(
      'Radarr unmonitors deleted movies: a rescan after a container change can leave a movie unmonitored',
    );
  });
  it('is quiet when the field is false', () => {
    expect(unmonitorWarning(sonarr, 'episodes')).toEqual({ warning: null, fieldSeen: FIELD });
  });
  it('reports an absent field as not seen', () => {
    const { [FIELD]: _gone, ...rest } = sonarr;
    expect(unmonitorWarning(rest, 'episodes')).toEqual({ warning: null, fieldSeen: null });
    expect(unmonitorWarning(null, 'movies')).toEqual({ warning: null, fieldSeen: null });
  });
  it('reads the movies key from the radarr fixture', () => {
    expect(unmonitorWarning(arrFixture('radarr-mediamanagement'), 'movies')).toEqual({
      warning: null,
      fieldSeen: 'autoUnmonitorPreviouslyDownloadedMovies',
    });
  });
});
