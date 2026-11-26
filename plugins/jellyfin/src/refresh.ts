import { defineNode, fetchErrorKind, type PluginContext } from '@transcoda/sdk';
import { z } from 'zod';
import { jellyfinPost } from './auth.ts';
import { findItemByPath, LookupFailed } from './find-item.ts';

export const refresh = defineNode({
  type: 'jellyfin:refresh',
  version: 1,
  kind: 'finish',
  finishPhase: 'media-server',
  title: 'Refresh in Jellyfin',
  description:
    'After the file is replaced, asks Jellyfin to rescan it (or the whole library) and to read the new file.',
  icon: 'refresh',
  inputs: [{ id: 'file', label: 'File', type: 'file' }],
  outputs: [],
  settings: z.object({
    scope: z
      .enum(['file', 'library'])
      .default('file')
      .describe("Rescan only this file's folder, or every library"),
  }),
  async finish(_ctx, settings) {
    return {
      actions: [
        {
          kind: 'plugin',
          description:
            settings.scope === 'library'
              ? 'ask Jellyfin to rescan every library'
              : 'ask Jellyfin to rescan the file',
          required: false,
        },
      ],
      reason: 'refresh after the write',
    };
  },
  async run(ctx, settings) {
    const plugin = ctx.plugin;
    const library = settings.scope === 'library';
    const remoteNew = plugin.paths.toRemote(ctx.newPath);
    try {
      const res = library
        ? await jellyfinPost(plugin, '/Library/Refresh')
        : await jellyfinPost(plugin, '/Library/Media/Updated', {
            Updates: [
              { Path: remoteNew, UpdateType: 'Modified' },
              ...(ctx.originalPath !== ctx.newPath
                ? [{ Path: plugin.paths.toRemote(ctx.originalPath), UpdateType: 'Deleted' }]
                : []),
            ],
          });
      if (res.status !== 204 && res.status !== 200) {
        return { ok: false, message: `Jellyfin answered ${res.status} to the rescan request` };
      }
      const asked = library
        ? 'asked Jellyfin to rescan every library'
        : `asked Jellyfin to rescan ${remoteNew}`;
      // A file at a new path is new to Jellyfin, which reads it in full. A file replaced in place
      // keeps its modified time, so a rescan leaves the streams Jellyfin stored for the old file.
      if (ctx.originalPath !== ctx.newPath) return { ok: true, message: asked };
      return await reread(plugin, remoteNew, asked);
    } catch (e) {
      const kind = fetchErrorKind(e);
      if (kind !== null) {
        return {
          ok: false,
          retryable: kind !== 'refused',
          message: `Jellyfin unreachable: ${kind}`,
        };
      }
      throw e;
    }
  },
});

/** Has Jellyfin read the replaced file again, so it stops serving the old file's streams. */
async function reread(plugin: PluginContext, remotePath: string, asked: string) {
  let id: string | null;
  try {
    id = await findItemByPath(plugin, remotePath);
  } catch (e) {
    if (!(e instanceof LookupFailed)) throw e;
    return { ok: false, message: `${asked}, but could not find its item: ${e.message}` };
  }
  if (id === null) return { ok: true, message: `${asked}; Jellyfin has no item for it yet` };
  const q = new URLSearchParams({
    metadataRefreshMode: 'FullRefresh',
    imageRefreshMode: 'Default',
    replaceAllMetadata: 'false',
    replaceAllImages: 'false',
    regenerateTrickplay: 'false',
  });
  const res = await jellyfinPost(plugin, `/Items/${encodeURIComponent(id)}/Refresh?${q}`);
  if (res.status !== 204 && res.status !== 200) {
    return {
      ok: false,
      message: `${asked}, but Jellyfin answered ${res.status} to the request to read it again`,
    };
  }
  return { ok: true, message: `${asked} and to read the new file` };
}
