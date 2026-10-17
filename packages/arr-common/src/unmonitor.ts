import type { JsonValue } from './json.ts';

const FIELDS = {
  episodes: 'autoUnmonitorPreviouslyDownloadedEpisodes',
  movies: 'autoUnmonitorPreviouslyDownloadedMovies',
} as const;

const WARNINGS = {
  episodes:
    'Sonarr unmonitors deleted episodes: a rescan after a container change can leave an episode unmonitored',
  movies:
    'Radarr unmonitors deleted movies: a rescan after a container change can leave a movie unmonitored',
} as const;

/** Absent field: no warning and `fieldSeen: null`; the caller logs the keys at debug level. */
export function unmonitorWarning(
  config: JsonValue,
  kind: 'episodes' | 'movies',
): { warning: string | null; fieldSeen: string | null } {
  const field = FIELDS[kind];
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { warning: null, fieldSeen: null };
  }
  const value = config[field];
  if (typeof value !== 'boolean') return { warning: null, fieldSeen: null };
  return { warning: value ? WARNINGS[kind] : null, fieldSeen: field };
}
