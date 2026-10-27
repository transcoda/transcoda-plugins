import {
  ArrHttpError,
  arrClient,
  idsOf,
  type JsonValue,
  pickByPath,
  sameFile,
} from '@transcoda/plugin-arr-common';
import { fetchErrorKind, type PluginContext } from '@transcoda/sdk';

export interface SeriesRef {
  id: number;
  title: string;
  path: string;
  tvdbId?: number;
  tmdbId?: number;
  imdbId?: string;
  originalLanguage?: { name: string };
}
export interface EpisodeFileRef {
  id: number;
  path: string;
}

const SERIES_TTL_MS = 600_000;

const isObj = (v: unknown): v is Record<string, JsonValue> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function toSeries(v: JsonValue): SeriesRef | null {
  if (!isObj(v) || typeof v.id !== 'number' || typeof v.path !== 'string') return null;
  const ref: SeriesRef = {
    id: v.id,
    title: typeof v.title === 'string' ? v.title : String(v.id),
    path: v.path,
  };
  if (typeof v.tvdbId === 'number') ref.tvdbId = v.tvdbId;
  if (typeof v.tmdbId === 'number') ref.tmdbId = v.tmdbId;
  if (typeof v.imdbId === 'string') ref.imdbId = v.imdbId;
  const lang = v.originalLanguage;
  if (isObj(lang) && typeof lang.name === 'string') ref.originalLanguage = { name: lang.name };
  return ref;
}

function toFile(v: JsonValue): EpisodeFileRef | null {
  return isObj(v) && typeof v.id === 'number' && typeof v.path === 'string'
    ? { id: v.id, path: v.path }
    : null;
}

/** `idsOf` for a series (positive ids only, `imdbId` must look like `tt…`). */
export function idsOfSeries(series: SeriesRef): ReturnType<typeof idsOf> {
  const o: Record<string, JsonValue> = {};
  if (series.tvdbId !== undefined) o.tvdbId = series.tvdbId;
  if (series.tmdbId !== undefined) o.tmdbId = series.tmdbId;
  if (series.imdbId !== undefined) o.imdbId = series.imdbId;
  return idsOf(o);
}

async function allSeries(ctx: PluginContext): Promise<SeriesRef[]> {
  const cached = await ctx.cache.get('series');
  let raw: JsonValue;
  if (cached !== undefined) {
    raw = cached;
  } else {
    raw = await arrClient(ctx, 'Sonarr').get('/api/v3/series');
    if (Array.isArray(raw)) await ctx.cache.set('series', raw, SERIES_TTL_MS);
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(toSeries).filter((s): s is SeriesRef => s !== null);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The episode files Sonarr lists for a series (never cached: the rescan changes them). */
export async function listEpisodeFiles(
  ctx: PluginContext,
  seriesId: number,
): Promise<EpisodeFileRef[]> {
  const raw = await arrClient(ctx, 'Sonarr').get(`/api/v3/episodefile?seriesId=${seriesId}`);
  return Array.isArray(raw) ? raw.map(toFile).filter((f): f is EpisodeFileRef => f !== null) : [];
}

/** The episodes held in one file: their ids and a label such as `S01E03E04`. */
async function fileEpisodes(
  ctx: PluginContext,
  seriesId: number,
  fileId: number,
  strict: boolean,
): Promise<{ label: string; ids: number[] }> {
  // Cosmetic for the label: unless `strict`, a failed lookup gives no episodes and never stops
  // the caller.
  let raw: JsonValue;
  try {
    raw = await arrClient(ctx, 'Sonarr').get(
      `/api/v3/episode?seriesId=${seriesId}&episodeFileId=${fileId}`,
    );
  } catch (e) {
    if (!strict && (e instanceof ArrHttpError || fetchErrorKind(e) !== null)) {
      return { label: '', ids: [] };
    }
    throw e;
  }
  if (!Array.isArray(raw)) return { label: '', ids: [] };
  // Sonarr answers with every episode of the series when seriesId is given (episodeFileId is
  // ignored), so keep only the episodes held in this file.
  const eps = raw
    .filter(isObj)
    .filter(
      (e) =>
        e.episodeFileId === fileId &&
        typeof e.id === 'number' &&
        typeof e.episodeNumber === 'number' &&
        typeof e.seasonNumber === 'number',
    )
    .map((e) => ({
      id: e.id as number,
      season: e.seasonNumber as number,
      episode: e.episodeNumber as number,
    }))
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
  const first = eps[0];
  if (first === undefined) return { label: '', ids: [] };
  const numbers = eps.filter((e) => e.season === first.season).map((e) => pad2(e.episode));
  return { label: `S${pad2(first.season)}E${numbers.join('E')}`, ids: eps.map((e) => e.id) };
}

/**
 * The series whose folder contains `localPath` (segment-aware, longest folder wins) and, unless
 * `lookupFile` is false, the episode file Sonarr lists at that path with the episodes it holds.
 * Throws on a failed series or episodefile request (fetch-kind errors, ArrHttpError); a failed
 * episode lookup gives no episodes unless `strictEpisodes`, when it throws too.
 */
export async function findSeriesForPath(
  ctx: PluginContext,
  localPath: string,
  opts: { lookupFile?: boolean; strictEpisodes?: boolean } = {},
): Promise<{
  series: SeriesRef;
  file: EpisodeFileRef | null;
  episodes: string;
  episodeIds: number[];
} | null> {
  const remotePath = ctx.paths.toRemote(localPath);
  const series = pickByPath(await allSeries(ctx), remotePath);
  if (series === null) return null;
  const none = { series, file: null, episodes: '', episodeIds: [] };
  if (opts.lookupFile === false) return none;
  const file = (await listEpisodeFiles(ctx, series.id)).find((f) => sameFile(f.path, remotePath));
  if (file === undefined) return none;
  const eps = await fileEpisodes(ctx, series.id, file.id, opts.strictEpisodes === true);
  return { series, file, episodes: eps.label, episodeIds: eps.ids };
}
