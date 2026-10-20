import { arrClient, type JsonValue, pickByPath, sameFile } from '@transcoda/plugin-arr-common';
import type { PluginContext } from '@transcoda/sdk';

export interface MovieRef {
  id: number;
  title: string;
  year: number | null;
  /** The movie's folder, as Radarr sees it. */
  path: string;
  tmdbId?: number;
  imdbId?: string;
  originalLanguage?: { name: string };
}

export interface MovieFileRef {
  id: number;
  path: string;
}

interface Entry extends MovieRef {
  /** Path of the movie file Radarr lists in the movie record, when it lists one. */
  moviePath: string | null;
}

const MOVIES_KEY = 'movies';
const MOVIES_TTL_MS = 600_000;

const isObj = (v: JsonValue | undefined): v is { [k: string]: JsonValue } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `Title (2019)`, or just the title when Radarr gives no year. */
export function movieLabel(m: { title: string; year: number | null }): string {
  return m.year === null ? m.title : `${m.title} (${m.year})`;
}

function toEntry(raw: JsonValue): Entry | null {
  if (!isObj(raw)) return null;
  const { id, title, path } = raw;
  if (typeof id !== 'number' || typeof title !== 'string' || typeof path !== 'string') return null;
  const year = typeof raw.year === 'number' && raw.year > 0 ? raw.year : null;
  const file = raw.movieFile;
  const entry: Entry = {
    id,
    title,
    year,
    path,
    moviePath: isObj(file) && typeof file.path === 'string' ? file.path : null,
  };
  if (typeof raw.tmdbId === 'number' && raw.tmdbId > 0) entry.tmdbId = raw.tmdbId;
  if (typeof raw.imdbId === 'string' && raw.imdbId.startsWith('tt')) entry.imdbId = raw.imdbId;
  const lang = raw.originalLanguage;
  if (isObj(lang) && typeof lang.name === 'string') entry.originalLanguage = { name: lang.name };
  return entry;
}

async function loadMovies(ctx: PluginContext): Promise<Entry[]> {
  let raw = await ctx.cache.get(MOVIES_KEY);
  if (raw === undefined) {
    raw = await arrClient(ctx, 'Radarr').get('/api/v3/movie');
    // Store only what the lookups use: the movie list of a big library is large.
    const slim = (Array.isArray(raw) ? raw : []).flatMap((r) => {
      const e = toEntry(r);
      return e === null ? [] : [e as unknown as JsonValue];
    });
    await ctx.cache.set(MOVIES_KEY, slim, MOVIES_TTL_MS);
    raw = slim;
  }
  return (Array.isArray(raw) ? raw : []).map((r) => r as unknown as Entry);
}

export function toMovieRef(e: MovieRef): MovieRef {
  const { id, title, year, path, tmdbId, imdbId, originalLanguage } = e;
  return {
    id,
    title,
    year,
    path,
    ...(tmdbId === undefined ? {} : { tmdbId }),
    ...(imdbId === undefined ? {} : { imdbId }),
    ...(originalLanguage === undefined ? {} : { originalLanguage }),
  };
}

/** The movie that owns `remotePath`: its movie file first, then its folder (segment-aware). */
export async function findMovie(ctx: PluginContext, remotePath: string): Promise<MovieRef | null> {
  const movies = await loadMovies(ctx);
  const byFile = movies.find((m) => m.moviePath !== null && sameFile(m.moviePath, remotePath));
  const hit = byFile ?? pickByPath(movies, remotePath);
  return hit === null ? null : toMovieRef(hit);
}

/** Radarr's current list of files for one movie. */
export async function movieFiles(ctx: PluginContext, movieId: number): Promise<MovieFileRef[]> {
  const raw = await arrClient(ctx, 'Radarr').get(`/api/v3/moviefile?movieId=${movieId}`);
  return (Array.isArray(raw) ? raw : []).flatMap((f) =>
    isObj(f) && typeof f.id === 'number' && typeof f.path === 'string'
      ? [{ id: f.id, path: f.path }]
      : [],
  );
}

export async function findMovieForPath(
  ctx: PluginContext,
  localPath: string,
): Promise<{ movie: MovieRef; file: MovieFileRef | null } | null> {
  const remotePath = ctx.paths.toRemote(localPath);
  const movie = await findMovie(ctx, remotePath);
  if (movie === null) return null;
  const files = await movieFiles(ctx, movie.id);
  return { movie, file: files.find((f) => sameFile(f.path, remotePath)) ?? null };
}
