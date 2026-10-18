import type { PluginContext, PluginFetchResponse } from '@transcoda/sdk';

export type JsonValue = PluginFetchResponse['body'];

/** Per-request timeout. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** `settings.url` without trailing slashes; a base path such as `/seerr` is kept. */
function baseUrl(ctx: PluginContext): string {
  return String(ctx.settings.url ?? '').replace(/\/+$/, '');
}

/**
 * encodeURIComponent plus `! ' ( ) *`, which it leaves raw. Seerr's OpenAPI validator answers
 * 400 "must be url encoded" for any of them unescaped (S4).
 */
export function strictEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * GET a Seerr API path. The key travels only in `auth` (S1). The caller reads the status
 * (a 404 and a 400 each mean something); fetch failures throw and are classified with
 * `fetchErrorKind`.
 */
export async function seerrGet(
  ctx: PluginContext,
  path: string,
  query?: Record<string, string>,
): Promise<{ status: number; body: JsonValue }> {
  const qs =
    query === undefined
      ? ''
      : `?${Object.entries(query)
          .map(([k, v]) => `${k}=${strictEncode(v)}`)
          .join('&')}`;
  const res = await ctx.fetch({
    url: `${baseUrl(ctx)}${path}${qs}`,
    method: 'GET',
    accept: 'json',
    auth: { header: { name: 'X-Api-Key', value: String(ctx.settings.apiKey ?? '') } },
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  return { status: res.status, body: res.body };
}
