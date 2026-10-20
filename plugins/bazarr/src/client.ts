import type { JsonValue } from '@transcoda/plugin-arr-common';
import { fetchErrorKind, type PluginContext } from '@transcoda/sdk';

/** Drops trailing slashes in linear time (a `/\/+$/` regex is quadratic on many slashes). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end--;
  return s.slice(0, end);
}

export class BazarrHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`Bazarr answered ${status} for ${path}`);
    this.name = 'BazarrHttpError';
  }
}

/** `settings.url` without trailing slashes; a base path such as `/bazarr` is kept. */
export function bazarrBaseUrl(ctx: PluginContext): string {
  return stripTrailingSlashes(String(ctx.settings.url ?? ''));
}

export type Query = Record<string, string | string[]>;

/** `a=1&b[]=2&b[]=3`: array values repeat as `key[]=v`; values are percent-encoded. */
function queryString(query: Query): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const v of value) parts.push(`${key}[]=${encodeURIComponent(v)}`);
    } else {
      parts.push(`${key}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join('&');
}

export interface BazarrClient {
  get(path: string, query?: Query, opts?: { timeoutMs?: number }): Promise<JsonValue>;
  /** Returns the HTTP status; a 4xx or 5xx answer is not an error here (callers decide). */
  patch(
    path: string,
    query: Record<string, string>,
    opts?: { timeoutMs?: number },
  ): Promise<number>;
}

export function bazarrClient(ctx: PluginContext): BazarrClient {
  const timeout = Number(ctx.settings.timeoutSeconds ?? 30) * 1000;
  const urlOf = (path: string, query: Query | undefined) => {
    const qs = query === undefined ? '' : queryString(query);
    return bazarrBaseUrl(ctx) + path + (qs === '' ? '' : `?${qs}`);
  };
  // The key travels only in the structured `auth` field; the server applies it.
  const auth = { header: { name: 'X-API-KEY', value: String(ctx.settings.apiKey ?? '') } };
  return {
    async get(path, query, opts) {
      const res = await ctx.fetch({
        url: urlOf(path, query),
        method: 'GET',
        auth,
        accept: 'json',
        timeoutMs: opts?.timeoutMs ?? timeout,
      });
      if (res.status >= 400) throw new BazarrHttpError(res.status, path);
      return res.body;
    },
    async patch(path, query, opts) {
      const res = await ctx.fetch({
        url: urlOf(path, query),
        method: 'PATCH',
        auth,
        accept: 'none',
        timeoutMs: opts?.timeoutMs ?? timeout,
      });
      return res.status;
    },
  };
}

/**
 * A short, secret-free description of an expected Bazarr failure; null for anything else
 * (a programming error), which callers rethrow. Fetch failures are classified by `kind`.
 */
export function describeFailure(e: unknown): { message: string; retryable: boolean } | null {
  const kind = fetchErrorKind(e);
  if (kind !== null) {
    return { message: `Bazarr unreachable: ${kind}`, retryable: kind !== 'refused' };
  }
  if (e instanceof BazarrHttpError) return { message: e.message, retryable: e.status >= 500 };
  return null;
}
