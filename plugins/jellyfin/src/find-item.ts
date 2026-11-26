import type { PluginContext } from '@transcoda/sdk';
import { jellyfinGet } from './auth.ts';

/** How many levels the walk descends before it searches the rest of the subtree in one request. */
const MAX_DEPTH = 6;

type Entry = { id: string; path: string | null };

export class LookupFailed extends Error {}

/** True when `path` is `dir` itself or lies inside it, for / and \ separated paths alike. */
export function isWithin(path: string, dir: string): boolean {
  if (path === dir) return true;
  const last = dir.at(-1);
  const prefix = last === '/' || last === '\\' ? dir : `${dir}${dir.includes('\\') ? '\\' : '/'}`;
  return path.startsWith(prefix);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function asArray(body: unknown, key?: string): unknown[] {
  const list =
    key === undefined
      ? body
      : typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)[key]
        : null;
  if (!Array.isArray(list)) throw new LookupFailed('Jellyfin sent an unexpected answer');
  return list;
}

async function getJson(ctx: PluginContext, path: string): Promise<unknown> {
  const res = await jellyfinGet(ctx, path);
  if (res.status !== 200)
    throw new LookupFailed(`Jellyfin answered ${res.status} to ${path.split('?')[0]}`);
  return res.body;
}

async function libraries(ctx: PluginContext, remotePath: string): Promise<string[]> {
  const folders = asArray(await getJson(ctx, '/Library/VirtualFolders'));
  const ids: string[] = [];
  for (const f of folders) {
    if (typeof f !== 'object' || f === null) continue;
    const rec = f as Record<string, unknown>;
    const id = str(rec.ItemId);
    const locations = Array.isArray(rec.Locations) ? rec.Locations : [];
    if (
      id !== null &&
      locations.some((l) => str(l) !== null && isWithin(remotePath, l as string))
    ) {
      ids.push(id);
    }
  }
  return ids;
}

async function items(ctx: PluginContext, parentId: string, recursive: boolean): Promise<Entry[]> {
  const q = new URLSearchParams({
    parentId,
    fields: 'Path',
    enableImages: 'false',
    enableUserData: 'false',
    enableTotalRecordCount: 'false',
  });
  if (recursive) {
    q.set('recursive', 'true');
    q.set('filters', 'IsNotFolder');
  }
  const list = asArray(await getJson(ctx, `/Items?${q}`), 'Items');
  const out: Entry[] = [];
  for (const it of list) {
    if (typeof it !== 'object' || it === null) continue;
    const rec = it as Record<string, unknown>;
    const id = str(rec.Id);
    if (id !== null) out.push({ id, path: str(rec.Path) });
  }
  return out;
}

/**
 * The id of the Jellyfin item whose file is `remotePath`, or null when Jellyfin has none.
 * Jellyfin cannot look items up by path, so this walks down from the library whose folder holds
 * the file, following the children whose folder contains it. Where no child's folder does (a
 * season without its own folder, say), it searches the rest of that subtree in one request.
 */
export async function findItemByPath(
  ctx: PluginContext,
  remotePath: string,
): Promise<string | null> {
  for (const library of await libraries(ctx, remotePath)) {
    let parent = library;
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const children = await items(ctx, parent, false);
      const exact = children.find((c) => c.path === remotePath);
      if (exact !== undefined) return exact.id;
      const next = children.find((c) => c.path !== null && isWithin(remotePath, c.path));
      if (next === undefined) break;
      parent = next.id;
    }
    const found = (await items(ctx, parent, true)).find((c) => c.path === remotePath);
    if (found !== undefined) return found.id;
  }
  return null;
}
