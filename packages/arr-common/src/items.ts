import type { PluginContext } from '@transcoda/sdk';
import { type ArrProduct, arrClient } from './client.ts';
import type { JsonValue } from './json.ts';

/** How long a manager's item list (all movies, all series) is reused between lookups. */
export const ITEMS_TTL_MS = 600_000;

/**
 * The manager's item list at `path` (`/api/v3/movie`, `/api/v3/series`), each record reduced by
 * `slim` to what the lookups use; records `slim` rejects are dropped. Only the slim list is cached
 * (for 10 min under `key`): the full list of a big library is large.
 */
export async function cachedItems<T>(
  ctx: PluginContext,
  product: ArrProduct,
  opts: { key: string; path: string; slim: (raw: JsonValue) => T | null },
): Promise<T[]> {
  const cached = await ctx.cache.get(opts.key);
  if (Array.isArray(cached)) return cached as unknown as T[];
  const raw = await arrClient(ctx, product).get(opts.path);
  const items = (Array.isArray(raw) ? raw : []).flatMap((r) => {
    const item = opts.slim(r);
    return item === null ? [] : [item];
  });
  await ctx.cache.set(opts.key, items as unknown as JsonValue, ITEMS_TTL_MS);
  return items;
}
