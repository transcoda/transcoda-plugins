import type { PluginContext } from '@transcoda/sdk';
import { type ArrProduct, arrClient } from './client.ts';
import { isUnder } from './paths.ts';

const ROOTS_KEY = 'rootfolders';
const ROOTS_TTL_MS = 600_000;

/** The service's root folders, as it sees them (cached for 10 min). */
export async function rootFolders(ctx: PluginContext, product: ArrProduct): Promise<string[]> {
  const cached = await ctx.cache.get(ROOTS_KEY);
  if (Array.isArray(cached)) return cached.filter((p): p is string => typeof p === 'string');
  const raw = await arrClient(ctx, product).get('/api/v3/rootfolder');
  const roots = (Array.isArray(raw) ? raw : []).flatMap((r) =>
    typeof r === 'object' && r !== null && !Array.isArray(r) && typeof r.path === 'string'
      ? [r.path]
      : [],
  );
  await ctx.cache.set(ROOTS_KEY, roots, ROOTS_TTL_MS);
  return roots;
}

/**
 * "Radarr does not know <path>", naming the path as the service was asked for it. When that path
 * lies outside every root folder of the service, the likely cause is a missing path mapping, and
 * the message says so. The root folders are a hint only: when they cannot be read, the plain
 * message stands.
 */
export async function notKnownMessage(
  ctx: PluginContext,
  product: ArrProduct,
  remotePath: string,
): Promise<string> {
  const plain = `${product} does not know ${remotePath}`;
  let roots: string[];
  try {
    roots = await rootFolders(ctx, product);
  } catch {
    return plain;
  }
  if (roots.length === 0 || roots.some((root) => isUnder(root, remotePath))) return plain;
  return `${plain}, which is outside its root folders (${roots.join(', ')}): add a path mapping in the ${product} settings`;
}
