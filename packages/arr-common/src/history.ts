import type { ArrClient } from './client.ts';
import type { JsonValue } from './json.ts';

/** How long a replace request for one item stands: no second one within this window. */
export const REQUEST_WINDOW_MS = 7 * 86_400_000;

export interface HistoryEvent {
  id: number;
  eventType: string;
  date: string;
  sourceTitle: string;
  /** Sonarr only: the episode the event belongs to. */
  episodeId?: number;
  /** The download client's id: ties a `grabbed` event to the import it produced. */
  downloadId?: string;
}

/**
 * The event a finished download leaves when the manager imports it, in both Radarr and Sonarr
 * (`movieFolderImported`/`seriesFolderImported` are library scans and carry no download).
 */
const IMPORTED = 'downloadFolderImported';

const isObj = (v: JsonValue | undefined): v is { [k: string]: JsonValue } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const time = (date: string) => Date.parse(date);

function toEvent(v: JsonValue): HistoryEvent | null {
  if (!isObj(v)) return null;
  const { id, eventType, date, sourceTitle, episodeId, downloadId } = v;
  if (
    typeof id !== 'number' ||
    typeof eventType !== 'string' ||
    typeof date !== 'string' ||
    Number.isNaN(time(date))
  ) {
    return null;
  }
  return {
    id,
    eventType,
    date,
    sourceTitle: typeof sourceTitle === 'string' ? sourceTitle : '',
    ...(typeof episodeId === 'number' ? { episodeId } : {}),
    ...(typeof downloadId === 'string' && downloadId !== '' ? { downloadId } : {}),
  };
}

/**
 * The history of one item: `/api/v3/history/movie?movieId=<id>` (Radarr) or
 * `/api/v3/history/series?seriesId=<id>` (Sonarr, which has no episode filter; filter with
 * `episodeIds` below). Events without an id, a type or a readable date are dropped.
 */
export async function itemHistory(client: ArrClient, path: string): Promise<HistoryEvent[]> {
  const raw = await client.get(path);
  return (Array.isArray(raw) ? raw : []).flatMap((v) => {
    const e = toEvent(v);
    return e === null ? [] : [e];
  });
}

function newest(
  events: HistoryEvent[],
  eventType: string,
  episodeIds: readonly number[] | undefined,
  also: (e: HistoryEvent) => boolean = () => true,
): HistoryEvent | null {
  let best: HistoryEvent | null = null;
  for (const e of events) {
    if (e.eventType !== eventType || !also(e)) continue;
    if (
      episodeIds !== undefined &&
      (e.episodeId === undefined || !episodeIds.includes(e.episodeId))
    )
      continue;
    if (best === null || time(e.date) > time(best.date)) best = e;
  }
  return best;
}

/** The newest import event of the item (of one of `episodeIds`, when given). */
export function latestImport(
  events: HistoryEvent[],
  opts: { episodeIds?: readonly number[] } = {},
): HistoryEvent | null {
  return newest(events, IMPORTED, opts.episodeIds);
}

/**
 * The newest `downloadFailed` event (of one of `episodeIds`, when given) inside the window and
 * newer than the latest import: a failure before the import concerns an earlier file.
 */
export function recentMarkedFailed(
  events: HistoryEvent[],
  opts: { episodeIds?: readonly number[]; now: number; windowMs: number },
): { date: string } | null {
  const imported = latestImport(events, opts);
  const after = imported === null ? Number.NEGATIVE_INFINITY : time(imported.date);
  const hit = newest(events, 'downloadFailed', opts.episodeIds, (e) => time(e.date) > after);
  return hit !== null && time(hit.date) >= opts.now - opts.windowMs ? { date: hit.date } : null;
}

/**
 * The `grabbed` event that produced the file: the one sharing its `downloadId` with the newest
 * import (of one of `episodeIds`, when given). Null when that import has no downloadId or no
 * grab matches it; a newer grab (an upgrade, a single episode of a pack) is never picked.
 */
export function importedGrab(
  events: HistoryEvent[],
  opts: { episodeIds?: readonly number[] } = {},
): { id: number; sourceTitle: string } | null {
  const downloadId = latestImport(events, opts)?.downloadId;
  if (downloadId === undefined) return null;
  const hit = newest(events, 'grabbed', opts.episodeIds, (e) => e.downloadId === downloadId);
  return hit === null ? null : { id: hit.id, sourceTitle: hit.sourceTitle };
}

export type BlocklistItem =
  | { movieId: number }
  | { seriesId: number; episodeIds: readonly number[] };

/**
 * The newest blocklist entry for the item inside the window and after `after` (the latest import,
 * when known). Reads the first page, newest first, filtered by the item where the server supports
 * it; the item is matched again here, since an older server ignores the filter.
 *
 * Best-effort: the history check (`recentMarkedFailed`) is the primary guard. Only one page is
 * read, so on a server that ignores the filter a busy blocklist can push the item's entry off it.
 */
export async function recentBlocklisted(
  client: ArrClient,
  item: BlocklistItem,
  opts: { now: number; windowMs: number; after?: number },
): Promise<{ date: string } | null> {
  const filter = 'movieId' in item ? `movieIds=${item.movieId}` : `seriesIds=${item.seriesId}`;
  const raw = await client.get(
    `/api/v3/blocklist?page=1&pageSize=100&sortKey=date&sortDirection=descending&${filter}`,
  );
  const records = isObj(raw) && Array.isArray(raw.records) ? raw.records : [];
  let best: string | null = null;
  for (const r of records) {
    if (!isObj(r) || typeof r.date !== 'string' || Number.isNaN(time(r.date))) continue;
    if ('movieId' in item) {
      if (r.movieId !== item.movieId) continue;
    } else {
      const ids = Array.isArray(r.episodeIds) ? r.episodeIds : [];
      if (r.seriesId !== item.seriesId || !ids.some((id) => item.episodeIds.includes(id as number)))
        continue;
    }
    if (time(r.date) < opts.now - opts.windowMs) continue;
    if (opts.after !== undefined && time(r.date) <= opts.after) continue;
    if (best === null || time(r.date) > time(best)) best = r.date;
  }
  return best === null ? null : { date: best };
}
