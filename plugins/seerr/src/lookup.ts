import { idsOf } from '@transcoda/plugin-arr-common';
import { fetchErrorKind, type PluginContext } from '@transcoda/sdk';
import { type JsonValue, seerrGet } from './client.ts';

export type MediaKind = 'auto' | 'movie' | 'tv';
type Kind = 'movie' | 'tv';
// A type alias (not an interface) so it is assignable to a data value.
export type RequestInfo = {
  requested: boolean | 'unknown';
  requestedBy: string | 'unknown';
  requestedAt: string | 'unknown';
};

type Result = { value: RequestInfo; reason: string };

const UNKNOWN: RequestInfo = {
  requested: 'unknown',
  requestedBy: 'unknown',
  requestedAt: 'unknown',
};
const NOT_REQUESTED: RequestInfo = { requested: false, requestedBy: '', requestedAt: '' };
const DECLINED = 3; // S3 (status 4, failed, still counts as requested)

const isObj = (v: unknown): v is Record<string, JsonValue> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const unknown = (reason: string): Result => ({ value: { ...UNKNOWN }, reason });

/** S4 input: `"Title (2001)"` → title + year; anything not a non-blank string is no title. */
function titleOf(raw: unknown): { title: string; year: number | null } | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t === '' || t === 'unknown') return null;
  const m = /^(.*\S)\s*\((\d{4})\)$/.exec(t);
  const parsed =
    m?.[1] !== undefined && m[2] !== undefined
      ? { title: m[1], year: Number(m[2]) }
      : { title: t, year: null };
  // A title with no letter or digit (punctuation only) would match anything or nothing.
  return norm(parsed.title) === '' ? null : parsed;
}

/**
 * S4: letters, digits and single spaces only: the retry when Seerr's "must be url encoded"
 * validator still answers 400 for a query (a safety net; strict encoding should avoid it).
 */
function cleaned(s: string): string {
  return s
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function norm(s: string): string {
  return cleaned(s).toLowerCase();
}

/** The requester's name as safe to show: never an email address (S6). */
function requesterName(by: JsonValue | undefined): string {
  if (!isObj(by)) return 'unknown';
  const name = by.displayName;
  if (typeof name === 'string' && name.trim() !== '' && !name.includes('@')) return name.trim();
  return typeof by.id === 'number' && Number.isFinite(by.id) ? `user #${by.id}` : 'unknown';
}

function statusFailure(status: number, what: string): Result {
  if (status === 401 || status === 403) return unknown('Seerr rejected the API key');
  if (status === 404) return unknown(`Seerr does not know ${what}`);
  return unknown(`Seerr answered HTTP ${status} for ${what}`);
}

/** The outcome for a media body (movie, tv or a search hit) that may carry `mediaInfo.requests`. */
function fromRequests(label: string, requests: JsonValue[]): Result {
  const live = requests.filter(isObj).filter((r) => r.status !== DECLINED);
  const time = (r: Record<string, JsonValue>): number => {
    const t = typeof r.createdAt === 'string' ? Date.parse(r.createdAt) : Number.NaN;
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  let first: Record<string, JsonValue> | undefined;
  for (const r of live) if (first === undefined || time(r) < time(first)) first = r;
  if (first === undefined) {
    return { value: { ...NOT_REQUESTED }, reason: `${label}: not requested in Seerr` };
  }
  const by = requesterName(first.requestedBy);
  const at =
    typeof first.createdAt === 'string' && !Number.isNaN(Date.parse(first.createdAt))
      ? first.createdAt
      : 'unknown';
  const when = at === 'unknown' ? ' (date unknown)' : ` on ${at.slice(0, 10)}`;
  return {
    value: { requested: true, requestedBy: by, requestedAt: at },
    reason: `${label}: requested by ${by}${when}`,
  };
}

async function byId(
  ctx: PluginContext,
  kind: Kind,
  tmdbId: number,
  expectTitle?: string,
): Promise<Result> {
  const res = await seerrGet(ctx, `/api/v1/${kind}/${tmdbId}`);
  // S3: Seerr answers 500 "Unable to retrieve movie." (or "…series.") for an id TMDB does not know.
  if (res.status === 500) {
    return unknown(`Seerr could not load TMDB id ${tmdbId} (unknown id, or TMDB unreachable)`);
  }
  if (res.status < 200 || res.status >= 300) return statusFailure(res.status, `TMDB id ${tmdbId}`);
  const body = isObj(res.body) ? res.body : {};
  const name = body.title ?? body.name;
  const label = typeof name === 'string' && name !== '' ? name : `TMDB id ${tmdbId}`;
  if (expectTitle !== undefined && typeof name === 'string' && norm(name) !== norm(expectTitle)) {
    // Radarr-style ids carry no kind, so `auto` guessed "movie"; a different title means the
    // tmdbId belongs to something else (for example a show).
    return unknown(
      `TMDB id ${tmdbId} is "${name}" in Seerr, not "${expectTitle}"; cannot tell which one was meant`,
    );
  }
  const info = body.mediaInfo;
  const requests = isObj(info) && Array.isArray(info.requests) ? info.requests : [];
  return fromRequests(label, requests);
}

const yearOf = (hit: Record<string, JsonValue>): number | null => {
  const d = hit.releaseDate ?? hit.firstAirDate;
  const y = typeof d === 'string' ? Number.parseInt(d.slice(0, 4), 10) : Number.NaN;
  return Number.isNaN(y) ? null : y;
};

async function search(ctx: PluginContext, title: string): Promise<JsonValue[] | Result> {
  let res = await seerrGet(ctx, '/api/v1/search', { query: title, page: '1' });
  // S4: Seerr's "must be url encoded" validator answers 400 for reserved characters. Strict
  // encoding avoids it; if a 400 still comes, retry once with the cleaned title.
  if (res.status === 400) {
    const retry = cleaned(title);
    if (retry !== '' && retry !== title) {
      res = await seerrGet(ctx, '/api/v1/search', { query: retry, page: '1' });
    }
  }
  if (res.status < 200 || res.status >= 300) {
    return statusFailure(res.status, `a search for "${title}"`);
  }
  return isObj(res.body) && Array.isArray(res.body.results) ? res.body.results : [];
}

/** A match made by title alone is weaker than one with a year; the reason says so. */
function noYearNote(r: Result, wanted: { year: number | null }): Result {
  return wanted.year === null && r.value.requested !== 'unknown'
    ? { ...r, reason: `${r.reason} (matched by title, no year)` }
    : r;
}

async function byTitle(
  ctx: PluginContext,
  wanted: { title: string; year: number | null },
  kinds: Kind[],
): Promise<Result> {
  const found = await search(ctx, wanted.title);
  if (!Array.isArray(found)) return found;
  const hits = found.filter(isObj).filter((h) => {
    if (!kinds.includes(h.mediaType as Kind)) return false;
    const name = h.title ?? h.name;
    if (typeof name !== 'string' || norm(name) === '' || norm(name) !== norm(wanted.title)) {
      return false;
    }
    return wanted.year === null || yearOf(h) === wanted.year;
  });
  const hit = hits[0];
  if (hit === undefined || hits.length !== 1 || typeof hit.id !== 'number') {
    const noYear = wanted.year === null ? ' (no year given)' : '';
    const why = hits.length === 0 ? `no match${noYear}` : `${hits.length} matches${noYear}`;
    return unknown(`Seerr search for "${wanted.title}": ${why}; connect ids from Sonarr or Radarr`);
  }
  const info = hit.mediaInfo;
  if (isObj(info) && Array.isArray(info.requests) && info.requests.length > 0) {
    return noYearNote(fromRequests(String(hit.title ?? hit.name), info.requests), wanted);
  }
  return noYearNote(await byId(ctx, hit.mediaType as Kind, hit.id), wanted);
}

/**
 * Was the title requested in Seerr, by whom and when. Ids win over the title; a Seerr that
 * cannot be reached or does not know the title gives 'unknown', never a guess.
 */
export async function lookupRequest(
  ctx: PluginContext,
  input: { ids: unknown; title: unknown; kind: MediaKind },
): Promise<Result> {
  const ids = idsOf((input.ids ?? null) as JsonValue);
  const title = titleOf(input.title);
  if (ids.tmdbId === undefined && ids.tvdbId === undefined && title === null) {
    return unknown('connect ids or a title (from Sonarr, Radarr or TMDB)');
  }
  try {
    if (ids.tmdbId !== undefined) {
      const kind: Kind =
        input.kind !== 'auto' ? input.kind : ids.tvdbId !== undefined ? 'tv' : 'movie';
      // S5: a bare tmdbId with kind auto is a guess ("movie"), so a connected title checks it.
      const guessed = input.kind === 'auto' && ids.tvdbId === undefined;
      return await byId(ctx, kind, ids.tmdbId, guessed && title !== null ? title.title : undefined);
    }
    // S5: no TVDB lookup exists, so a tvdbId alone needs a title to search with.
    if (title === null) return unknown('Seerr cannot look up a TVDB id; connect a title');
    const kinds: Kind[] =
      input.kind !== 'auto' ? [input.kind] : ids.tvdbId !== undefined ? ['tv'] : ['movie', 'tv'];
    return await byTitle(ctx, title, kinds);
  } catch (e) {
    const kind = fetchErrorKind(e);
    if (kind !== null) return unknown(`Seerr unreachable: ${kind}`);
    throw e;
  }
}
