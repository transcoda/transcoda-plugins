import { type JsonValue, pickByPath, sameFile } from '@transcoda/plugin-arr-common';
import type { PluginContext } from '@transcoda/sdk';
import { z } from 'zod';
import { bazarrClient } from './client.ts';
import { type BazarrSubtitle, subtitlesOf } from './subtitles.ts';

export type { BazarrSubtitle };

export type BazarrItem =
  | {
      kind: 'episode';
      seriesId: number;
      episodeId: number;
      title: string;
      path: string;
      subtitles: BazarrSubtitle[];
    }
  | {
      kind: 'movie';
      radarrId: number;
      title: string;
      path: string;
      subtitles: BazarrSubtitle[];
    };

export const ITEM_KINDS = ['auto', 'series', 'movie'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const kindSetting = () =>
  z
    .enum(ITEM_KINDS)
    .default('auto')
    .describe('Whether the file is an episode or a movie; auto looks for an episode first');

const SERIES_KEY = 'series';
const MOVIES_KEY = 'movies';
const TTL_MS = 600_000;
const PAGE = 500;
const MAX_PAGES = 200;

/**
 * Called before every request; the timeout it returns caps that request, so a caller with a time
 * limit passes `() => ({ timeoutMs: remaining })`. The default leaves the client's timeout alone.
 */
export type Budget = () => { timeoutMs?: number } | undefined;
const noBudget: Budget = () => undefined;

type Obj = { [k: string]: JsonValue };
const isObj = (v: JsonValue | undefined): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** B3: `length=-1` returns everything; when it is ignored, page until `total`. */
async function pagedList(ctx: PluginContext, path: string, budget: Budget): Promise<JsonValue[]> {
  const client = bazarrClient(ctx);
  const rows: JsonValue[] = [];
  let page = await client.get(path, { start: '0', length: '-1' }, budget());
  for (let i = 0; i < MAX_PAGES; i++) {
    const data = isObj(page) && Array.isArray(page.data) ? page.data : [];
    rows.push(...data);
    const total = isObj(page) && typeof page.total === 'number' ? page.total : rows.length;
    if (data.length === 0 || rows.length >= total) break;
    page = await client.get(path, { start: String(rows.length), length: String(PAGE) }, budget());
  }
  return rows;
}

const dataRows = (body: JsonValue): Obj[] =>
  isObj(body) && Array.isArray(body.data) ? body.data.filter(isObj) : [];

interface SeriesEntry {
  id: number;
  title: string;
  path: string | null;
}
interface MovieEntry {
  id: number;
  title: string;
  path: string;
}

/** Store only what the lookups use: the lists of a big library are large. */
async function cached<T>(ctx: PluginContext, key: string, load: () => Promise<T[]>): Promise<T[]> {
  const hit = await ctx.cache.get(key);
  if (Array.isArray(hit)) return hit as unknown as T[];
  const rows = await load();
  await ctx.cache.set(key, rows as unknown as JsonValue, TTL_MS);
  return rows;
}

const seriesList = (ctx: PluginContext, budget: Budget) =>
  cached<SeriesEntry>(ctx, SERIES_KEY, async () =>
    (await pagedList(ctx, '/api/series', budget)).flatMap((r) => {
      if (!isObj(r) || typeof r.sonarrSeriesId !== 'number' || typeof r.title !== 'string') {
        return [];
      }
      const path = typeof r.path === 'string' && r.path !== '' ? r.path : null;
      return [{ id: r.sonarrSeriesId, title: r.title, path }];
    }),
  );

const movieList = (ctx: PluginContext, budget: Budget) =>
  cached<MovieEntry>(ctx, MOVIES_KEY, async () =>
    (await pagedList(ctx, '/api/movies', budget)).flatMap((r) => {
      if (
        !isObj(r) ||
        typeof r.radarrId !== 'number' ||
        typeof r.title !== 'string' ||
        typeof r.path !== 'string'
      ) {
        return [];
      }
      return [{ id: r.radarrId, title: r.title, path: r.path }];
    }),
  );

const stripYear = (s: string) =>
  s
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim()
    .toLowerCase();

/** B3 fallback for a series list without `path`: the three nearest folder names against the title. */
function pickByTitle(entries: SeriesEntry[], remotePath: string): SeriesEntry | null {
  const folders = remotePath.split('/').filter((s) => s !== '');
  const names = new Set(folders.slice(0, -1).slice(-3).map(stripYear));
  const hits = entries.filter((e) => names.has(stripYear(e.title)));
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

function episodeLabel(seriesTitle: string, row: Obj): string {
  const { season, episode } = row;
  if (typeof season === 'number' && typeof episode === 'number') {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${seriesTitle} S${pad(season)}E${pad(episode)}`;
  }
  return typeof row.title === 'string' && row.title !== ''
    ? `${seriesTitle} ${row.title}`
    : seriesTitle;
}

function toEpisode(
  ctx: PluginContext,
  seriesTitle: string,
  row: Obj,
): Extract<BazarrItem, { kind: 'episode' }> | null {
  if (
    typeof row.sonarrSeriesId !== 'number' ||
    typeof row.sonarrEpisodeId !== 'number' ||
    typeof row.path !== 'string'
  ) {
    return null;
  }
  return {
    kind: 'episode',
    seriesId: row.sonarrSeriesId,
    episodeId: row.sonarrEpisodeId,
    title: episodeLabel(seriesTitle, row),
    path: row.path,
    subtitles: subtitlesOf(ctx, row.subtitles),
  };
}

function toMovie(ctx: PluginContext, row: Obj): Extract<BazarrItem, { kind: 'movie' }> | null {
  if (
    typeof row.radarrId !== 'number' ||
    typeof row.title !== 'string' ||
    typeof row.path !== 'string'
  ) {
    return null;
  }
  return {
    kind: 'movie',
    radarrId: row.radarrId,
    title: row.title,
    path: row.path,
    subtitles: subtitlesOf(ctx, row.subtitles),
  };
}

async function findEpisode(
  ctx: PluginContext,
  remote: string,
  budget: Budget,
): Promise<BazarrItem | null> {
  const all = await seriesList(ctx, budget);
  const withPath = all.filter((s): s is SeriesEntry & { path: string } => s.path !== null);
  const series =
    pickByPath(withPath, remote) ??
    pickByTitle(
      all.filter((s) => s.path === null),
      remote,
    );
  if (series === null) return null;
  const body = await bazarrClient(ctx).get(
    '/api/episodes',
    { seriesid: [String(series.id)] },
    budget(),
  );
  for (const row of dataRows(body)) {
    if (typeof row.path === 'string' && sameFile(row.path, remote)) {
      return toEpisode(ctx, series.title, row);
    }
  }
  return null;
}

async function findMovie(
  ctx: PluginContext,
  remote: string,
  budget: Budget,
): Promise<BazarrItem | null> {
  const hit = (await movieList(ctx, budget)).find((m) => sameFile(m.path, remote));
  if (hit === undefined) return null;
  // Subtitles change often (and the cached list carries none): read this movie fresh.
  return reloadMovie(ctx, hit.id, budget);
}

async function reloadMovie(
  ctx: PluginContext,
  radarrId: number,
  budget: Budget,
): Promise<BazarrItem | null> {
  const body = await bazarrClient(ctx).get(
    '/api/movies',
    { radarrid: [String(radarrId)] },
    budget(),
  );
  const row = dataRows(body).find((r) => r.radarrId === radarrId);
  return row === undefined ? null : toMovie(ctx, row);
}

/** The Bazarr item for a file (a path as Transcoda sees it), or null when Bazarr does not know it. */
export async function findItem(
  ctx: PluginContext,
  localPath: string,
  kind: ItemKind,
  budget: Budget = noBudget,
): Promise<BazarrItem | null> {
  const remote = ctx.paths.toRemote(localPath);
  if (kind !== 'movie') {
    const episode = await findEpisode(ctx, remote, budget);
    if (episode !== null || kind === 'series') return episode;
  }
  return findMovie(ctx, remote, budget);
}

/** Reads the item again by id (never cached); null when Bazarr no longer lists it. */
export async function reloadItem(
  ctx: PluginContext,
  item: BazarrItem,
  budget: Budget = noBudget,
): Promise<BazarrItem | null> {
  if (item.kind === 'movie') return reloadMovie(ctx, item.radarrId, budget);
  const body = await bazarrClient(ctx).get(
    '/api/episodes',
    { episodeid: [String(item.episodeId)] },
    budget(),
  );
  const row = dataRows(body).find((r) => r.sonarrEpisodeId === item.episodeId);
  if (row === undefined) return null;
  const fresh = toEpisode(ctx, '', row);
  return fresh === null ? null : { ...fresh, title: item.title };
}
