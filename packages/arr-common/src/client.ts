import type { PluginContext, PluginFetchResponse } from '@transcoda/sdk';
import type { JsonValue } from './json.ts';

/** Drops trailing slashes in linear time (a `/\/+$/` regex is quadratic on many slashes). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end--;
  return s.slice(0, end);
}

export type ArrProduct = 'Sonarr' | 'Radarr';

export class ArrHttpError extends Error {
  constructor(
    readonly product: ArrProduct,
    readonly status: number,
    readonly path: string,
  ) {
    super(`${product} answered ${status} for ${path}`);
    this.name = 'ArrHttpError';
  }
}

/** `settings.url` without trailing slashes; a base path such as `/sonarr` is kept. */
export function arrBaseUrl(settings: { url: string }): string {
  return stripTrailingSlashes(settings.url);
}

export interface ArrClient {
  get(path: string): Promise<JsonValue>;
  /** Without `body`, the request has none (e.g. `history/failed/{id}`). */
  post(path: string, body?: JsonValue): Promise<JsonValue>;
  put(path: string, body: JsonValue): Promise<JsonValue>;
  delete(path: string): Promise<JsonValue>;
}

/** Per-request timeout when the caller does not pass one. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export function arrClient(
  ctx: PluginContext,
  product: ArrProduct,
  opts: { timeoutMs?: number } = {},
): ArrClient {
  const send = async (
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    body?: JsonValue,
  ): Promise<JsonValue> => {
    const res: PluginFetchResponse = await ctx.fetch({
      url: arrBaseUrl({ url: String(ctx.settings.url ?? '') }) + path,
      method,
      ...(body === undefined ? {} : { body }),
      auth: { header: { name: 'X-Api-Key', value: String(ctx.settings.apiKey ?? '') } },
      accept: 'json',
      timeoutMs: opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    });
    if (res.status >= 400) throw new ArrHttpError(product, res.status, path);
    return res.body;
  };
  return {
    get: (path) => send(path, 'GET'),
    post: (path, body) => send(path, 'POST', body),
    put: (path, body) => send(path, 'PUT', body),
    delete: (path) => send(path, 'DELETE'),
  };
}

export const arrGet = (ctx: PluginContext, path: string, product: ArrProduct = 'Sonarr') =>
  arrClient(ctx, product).get(path);
export const arrPost = (
  ctx: PluginContext,
  path: string,
  body: JsonValue,
  product: ArrProduct = 'Sonarr',
) => arrClient(ctx, product).post(path, body);
