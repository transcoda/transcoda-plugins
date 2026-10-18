import { FetchRateLimited, type PluginContext, type PluginFetchResponse } from '@transcoda/sdk';

export type JsonValue = PluginFetchResponse['body'];

export const TMDB_ORIGIN = 'https://api.themoviedb.org';

/** A v3 API key is 32 lowercase hex characters; anything else is treated as a read access token. */
export function credentialKind(value: string): 'key' | 'token' {
  return /^[0-9a-f]{32}$/.test(value) ? 'key' : 'token';
}

/** TMDB answered, but not with a usable 2xx (404 is `null` instead). Carries no secret. */
export class TmdbHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`TMDB answered HTTP ${status}`);
    this.name = 'TmdbHttpError';
    this.status = status;
  }
}

function credentialOf(ctx: PluginContext): string {
  const value = ctx.settings.credential;
  return typeof value === 'string' ? value : '';
}

function languageOf(ctx: PluginContext): string {
  const value = ctx.settings.language;
  return typeof value === 'string' && value !== '' ? value : 'en-US';
}

/**
 * GET a TMDB v3 path. The credential travels only in `auth` (`api_key` query or bearer header),
 * never in the URL. 404 → null; other non-2xx → TmdbHttpError; 429 → FetchRateLimited.
 */
export async function tmdbGet(
  ctx: PluginContext,
  path: string,
  query: Record<string, string> = {},
): Promise<JsonValue | null> {
  const value = credentialOf(ctx);
  const params = new URLSearchParams({ ...query, language: languageOf(ctx) });
  const res = await ctx.fetch({
    url: `${TMDB_ORIGIN}${path}?${params.toString()}`,
    method: 'GET',
    accept: 'json',
    auth:
      credentialKind(value) === 'key' ? { query: { name: 'api_key', value } } : { bearer: value },
  });
  if (res.status === 404) return null;
  if (res.status === 429) throw new FetchRateLimited('TMDB rate limit hit');
  if (res.status < 200 || res.status >= 300) throw new TmdbHttpError(res.status);
  return res.body;
}

const FETCH_KINDS = ['refused', 'timeout', 'rate-limited', 'failed'] as const;
export type FetchKind = (typeof FETCH_KINDS)[number];

/**
 * The `kind` of a fetch failure. The host throws its own copy of the SDK's error classes, so
 * `instanceof` cannot be trusted: classify by the `kind` field.
 */
export function fetchKindOf(error: unknown): FetchKind | null {
  if (typeof error !== 'object' || error === null || !('kind' in error)) return null;
  const kind = (error as { kind: unknown }).kind;
  return FETCH_KINDS.find((k) => k === kind) ?? null;
}
