import { defineNode, FetchError } from '@transcoda/sdk';
import { z } from 'zod';
import { jellyfinPost } from './auth.ts';

export const refresh = defineNode({
  type: 'jellyfin:refresh',
  version: 1,
  kind: 'finish',
  finishPhase: 'media-server',
  title: 'Refresh in Jellyfin',
  description: 'After the file is replaced, asks Jellyfin to rescan it (or the whole library).',
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
      if (res.status === 204 || res.status === 200) {
        return {
          ok: true,
          message: library
            ? 'asked Jellyfin to rescan every library'
            : `asked Jellyfin to rescan ${remoteNew}`,
        };
      }
      return { ok: false, message: `Jellyfin answered ${res.status} to the rescan request` };
    } catch (e) {
      if (e instanceof FetchError) {
        return {
          ok: false,
          retryable: e.kind !== 'refused',
          message: `Jellyfin unreachable: ${e.kind}`,
        };
      }
      throw e;
    }
  },
});
