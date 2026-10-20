import { fetchErrorKind, type PluginContext } from '@transcoda/sdk';
import { type JsonValue, TmdbHttpError, tmdbGet } from './client.ts';
import { parseTitle } from './parse-title.ts';

export type LookupKind = 'auto' | 'movie' | 'tv';
type Kind = 'movie' | 'tv';

export interface LookupInput {
  ids: unknown;
  title: unknown;
  file: { path: string };
  kind: LookupKind;
}

export interface LookupResult {
  language: string | 'unknown';
  reason: string;
}

const FOUND_TTL_MS = 86_400_000;
const NEGATIVE_TTL_MS = 3_600_000;
// TMDB's own code for Cantonese; the shared language table does not know it.
const TMDB_LANGUAGE_ALIASES: Record<string, string> = { cn: 'yue' };

type Json = Record<string, JsonValue>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const objects = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObject) : []);

const DIGITS = /^\d+$/;
const IMDB = /^tt\d+$/;

/** A well-formed id as a string, else null (an invalid id is skipped without a request). */
function idOf(ids: unknown, key: string, pattern: RegExp): string | null {
  if (!isObject(ids)) return null;
  const v = ids[key];
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? String(v) : null;
  if (typeof v === 'string' && pattern.test(v.trim())) return v.trim();
  return null;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
function dirname(path: string): string {
  const at = path.lastIndexOf('/');
  return at <= 0 ? '' : path.slice(0, at);
}

function yearOf(date: JsonValue | undefined): number | null {
  if (typeof date !== 'string') return null;
  const m = /^(\d{4})/.exec(date);
  return m ? Number(m[1]) : null;
}

/** Case, punctuation and diacritics folded, for exact title comparison. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A definite "cannot tell"; `negative` answers may be cached briefly. */
class Unknown extends Error {
  readonly negative: boolean;
  constructor(message: string, negative = false) {
    super(message);
    this.negative = negative;
  }
}

/** `original_language` of a TMDB record as ISO 639-2/T, or throws Unknown with the reason. */
function languageOf(ctx: PluginContext, record: Json, how: string): string {
  const raw = record.original_language;
  if (typeof raw !== 'string' || raw === '' || raw === 'xx') {
    throw new Unknown(`TMDB has no original language for this title (${how})`);
  }
  const language = ctx.lang.normalise(TMDB_LANGUAGE_ALIASES[raw] ?? raw);
  if (language === 'unknown') throw new Unknown(`unrecognised TMDB language code "${raw}"`);
  return language;
}

/** One language from hits of different kinds; they must agree, otherwise it is a guess. */
function agreed(ctx: PluginContext, hits: Array<{ record: Json; how: string }>, clash: string) {
  const languages = hits.map((h) => languageOf(ctx, h.record, h.how));
  const [first] = languages;
  if (first === undefined || languages.some((l) => l !== first)) throw new Unknown(clash);
  return { language: first, reason: hits[0]?.how ?? '' };
}

async function byTmdbId(
  ctx: PluginContext,
  id: string,
  kinds: Kind[],
): Promise<LookupResult | null> {
  const hits: Array<{ record: Json; how: string }> = [];
  for (const kind of kinds) {
    const body = await tmdbGet(ctx, `/3/${kind}/${id}`);
    if (isObject(body)) hits.push({ record: body, how: `by TMDB id ${id}` });
  }
  if (hits.length === 0) return null;
  return agreed(
    ctx,
    hits,
    `ambiguous: TMDB id ${id} is both a movie and a show, with different original languages`,
  );
}

async function byExternalId(
  ctx: PluginContext,
  id: string,
  source: 'imdb_id' | 'tvdb_id',
  kinds: Kind[],
): Promise<LookupResult | null> {
  const body = await tmdbGet(ctx, `/3/find/${id}`, { external_source: source });
  if (!isObject(body)) return null;
  const label = source === 'imdb_id' ? 'IMDb' : 'TVDB';
  const hits: Array<{ record: Json; how: string }> = [];
  for (const kind of kinds) {
    const [first] = objects(body[kind === 'movie' ? 'movie_results' : 'tv_results']);
    if (first) hits.push({ record: first, how: `by ${label} id` });
  }
  if (hits.length === 0) return null;
  return agreed(ctx, hits, `ambiguous: ${label} id ${id} matches a movie and a show`);
}

/** Search results whose title (or original title) equals the wanted one exactly, once folded. */
async function exactMatches(
  ctx: PluginContext,
  kinds: Kind[],
  title: string,
  year: number | null,
): Promise<Json[]> {
  const want = fold(title);
  const found = new Map<string, Json>();
  if (want === '') return [];
  for (const kind of kinds) {
    const query: Record<string, string> = { query: title };
    if (year !== null) query[kind === 'movie' ? 'year' : 'first_air_date_year'] = String(year);
    const body = await tmdbGet(ctx, `/3/search/${kind}`, query);
    for (const r of objects(isObject(body) ? body.results : null)) {
      const names = kind === 'movie' ? [r.title, r.original_title] : [r.name, r.original_name];
      if (!names.some((n) => typeof n === 'string' && fold(n) === want)) continue;
      const date = kind === 'movie' ? r.release_date : r.first_air_date;
      if (year !== null && yearOf(date) !== year) continue;
      found.set(`${kind}:${String(r.id)}`, r);
    }
  }
  return [...found.values()];
}

/** A title from the `title` input is used as written; only a trailing "(year)" is taken off. */
function fromTitleInput(text: string): { title: string; year: number | null; kind: 'unknown' } {
  const m = /^(.*\S)\s*\(((?:19|20)\d{2})\)$/.exec(text);
  return m?.[1] !== undefined && m[2] !== undefined
    ? { title: m[1], year: Number(m[2]), kind: 'unknown' }
    : { title: text, year: null, kind: 'unknown' };
}

async function resolve(ctx: PluginContext, input: LookupInput): Promise<LookupResult> {
  const tmdbId = idOf(input.ids, 'tmdbId', DIGITS);
  const imdbId = idOf(input.ids, 'imdbId', IMDB);
  const tvdbId = idOf(input.ids, 'tvdbId', DIGITS);
  const idKinds: Kind[] = input.kind === 'auto' ? ['movie', 'tv'] : [input.kind];

  if (tmdbId !== null) {
    // A TVDB id means the ids come from Sonarr, so the TMDB id is a show's; otherwise a bare
    // id can be either kind, and the two must agree (see `agreed`).
    const kinds: Kind[] = input.kind === 'auto' && tvdbId !== null ? ['tv'] : idKinds;
    const hit = await byTmdbId(ctx, tmdbId, kinds);
    if (hit) return hit;
  }
  if (imdbId !== null) {
    const hit = await byExternalId(ctx, imdbId, 'imdb_id', idKinds);
    if (hit) return hit;
  }
  if (tvdbId !== null && input.kind !== 'movie') {
    const hit = await byExternalId(ctx, tvdbId, 'tvdb_id', ['tv']);
    if (hit) return hit;
  }

  const titleInput =
    typeof input.title === 'string' && input.title.trim() !== '' && input.title !== 'unknown'
      ? input.title.trim()
      : null;
  const wanted =
    titleInput !== null
      ? fromTitleInput(titleInput)
      : parseTitle(basename(input.file.path), dirname(input.file.path));
  if (wanted.title === '')
    throw new Unknown('no title to look up: the file name has nothing usable');
  const { title, year } = wanted;

  // A fixed kind wins. On auto, a name with an episode marker is a show and a name with only a
  // year is a movie: no fallback to the other kind (that is how wrong matches happen).
  let kinds: Kind[];
  if (input.kind !== 'auto') kinds = [input.kind];
  else if (wanted.kind === 'movie') kinds = ['movie'];
  else if (wanted.kind === 'tv') kinds = ['tv'];
  else kinds = ['movie', 'tv'];

  const found = await exactMatches(ctx, kinds, title, year);
  const label = year === null ? `"${title}"` : `"${title}" (${year})`;
  const [only] = found;
  if (found.length === 0) throw new Unknown(`no TMDB match for ${label}`, true);
  if (found.length > 1 || only === undefined) {
    throw new Unknown(`ambiguous: ${found.length} TMDB matches for ${label}`, true);
  }
  const how = `by title search ${label}`;
  return { language: languageOf(ctx, only, how), reason: how };
}

function cacheKey(input: LookupInput): string {
  const ids = [
    ['tmdbId', idOf(input.ids, 'tmdbId', DIGITS)],
    ['imdbId', idOf(input.ids, 'imdbId', IMDB)],
    ['tvdbId', idOf(input.ids, 'tvdbId', DIGITS)],
  ]
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  const title = typeof input.title === 'string' ? input.title : '';
  return `tmdb:${input.kind}:${ids}|${title}|${input.file.path}`;
}

/** Original language of a title as ISO 639-2/T; `'unknown'` with a reason whenever TMDB cannot tell. */
export async function lookupOriginalLanguage(
  ctx: PluginContext,
  input: LookupInput,
): Promise<LookupResult> {
  const key = cacheKey(input);
  const cached = await ctx.cache.get(key);
  const hit = isObject(cached) ? cached : null;
  if (hit !== null && typeof hit.language === 'string' && typeof hit.reason === 'string') {
    return { language: hit.language, reason: `${hit.reason} (cached)` };
  }
  const unknown = (reason: string): LookupResult => ({ language: 'unknown', reason });
  try {
    const result = await resolve(ctx, input);
    await ctx.cache.set(key, { ...result }, FOUND_TTL_MS);
    return result;
  } catch (error) {
    if (error instanceof Unknown) {
      if (error.negative) {
        await ctx.cache.set(key, { language: 'unknown', reason: error.message }, NEGATIVE_TTL_MS);
      }
      return unknown(error.message);
    }
    if (error instanceof TmdbHttpError) {
      return unknown(
        error.status === 401 || error.status === 403
          ? 'TMDB rejected the credential'
          : `TMDB answered HTTP ${error.status}`,
      );
    }
    const kind = fetchErrorKind(error);
    if (kind === 'rate-limited') return unknown('TMDB rate limit hit; try again later');
    if (kind !== null) return unknown(`TMDB unreachable: ${kind}`);
    throw error;
  }
}
