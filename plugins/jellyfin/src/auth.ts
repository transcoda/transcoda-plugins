import type { PluginContext, PluginFetchInput, PluginFetchResponse } from '@transcoda/sdk';

/** Drops trailing slashes in linear time (a `/\/+$/` regex is quadratic on many slashes). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end--;
  return s.slice(0, end);
}

export type JellyfinHeader = 'mediabrowser' | 'emby';

const HEADER_CACHE_KEY = 'authHeader';
const HEADER_CACHE_MS = 86_400_000;
export const LEGACY_HEADER_WARNING = 'Jellyfin accepted only the legacy X-Emby-Token header';

/**
 * The API key travels only inside the structured `auth` field: the host tokenises it, so the
 * real value never exists in this process's request. `MediaBrowser Token="<key>"` is a prefixed
 * raw value, which the tokenizer supports.
 */
export function jellyfinAuth(ctx: PluginContext, header: JellyfinHeader): PluginFetchInput['auth'] {
  const key = String(ctx.settings.apiKey);
  return header === 'emby'
    ? { header: { name: 'X-Emby-Token', value: key } }
    : { header: { name: 'Authorization', value: `MediaBrowser Token="${key}"` } };
}

export function jellyfinBase(ctx: PluginContext): string {
  return stripTrailingSlashes(String(ctx.settings.url));
}

async function currentHeader(ctx: PluginContext): Promise<JellyfinHeader> {
  return (await ctx.cache.get(HEADER_CACHE_KEY)) === 'emby' ? 'emby' : 'mediabrowser';
}

/** True when this server has been found to accept only the legacy header. */
export async function usesLegacyHeader(ctx: PluginContext): Promise<boolean> {
  return (await currentHeader(ctx)) === 'emby';
}

async function request(
  ctx: PluginContext,
  method: 'GET' | 'POST',
  path: string,
  body?: PluginFetchInput['body'],
): Promise<PluginFetchResponse> {
  const send = (header: JellyfinHeader) =>
    ctx.fetch({
      url: `${jellyfinBase(ctx)}${path}`,
      method,
      auth: jellyfinAuth(ctx, header),
      ...(body === undefined ? {} : { body }),
      accept: method === 'GET' ? 'json' : 'none',
    });
  const first = await currentHeader(ctx);
  const res = await send(first);
  if (res.status !== 401 || first !== 'mediabrowser') return res;
  const retry = await send('emby');
  if (retry.status < 400) {
    await ctx.cache.set(HEADER_CACHE_KEY, 'emby', HEADER_CACHE_MS);
    await ctx.log('warn', LEGACY_HEADER_WARNING);
  }
  return retry;
}

export const jellyfinGet = (ctx: PluginContext, path: string) => request(ctx, 'GET', path);
export const jellyfinPost = (ctx: PluginContext, path: string, body?: PluginFetchInput['body']) =>
  request(ctx, 'POST', path, body);
