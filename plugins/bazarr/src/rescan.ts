import { coalesce, sameFile } from '@transcoda/plugin-arr-common';
import { defineNode, type PluginContext } from '@transcoda/sdk';
import { z } from 'zod';
import { bazarrClient, describeFailure } from './client.ts';
import { type BazarrItem, findItem, kindSetting, reloadItem } from './find.ts';

const COALESCE_MS = 5000;

export const rescan = defineNode({
  type: 'bazarr:rescan',
  version: 1,
  kind: 'finish',
  finishPhase: 'library-manager',
  title: 'Rescan in Bazarr',
  description:
    'After the file is replaced, asks Bazarr to rescan its subtitles. Place it after the Sonarr or Radarr rescan.',
  icon: 'refresh',
  inputs: [{ id: 'file', label: 'File', type: 'file' }],
  outputs: [],
  settings: z.object({ kind: kindSetting() }),
  async finish() {
    return {
      actions: [
        {
          kind: 'plugin',
          description: 'ask Bazarr to rescan the subtitles of this file',
          required: false,
        },
      ],
      reason: 'Bazarr rescan after the write',
    };
  },
  async run(ctx, settings) {
    const plugin = ctx.plugin;
    const newRemote = plugin.paths.toRemote(ctx.newPath);
    try {
      // B7: Bazarr learns a changed path from Sonarr/Radarr, so look under the new path, then the old.
      const item =
        (await findItem(plugin, ctx.newPath, settings.kind)) ??
        (await findItem(plugin, ctx.originalPath, settings.kind));
      if (item === null) {
        return {
          ok: false,
          message: `Bazarr does not know ${newRemote}; it picks the file up when it next syncs with Sonarr or Radarr`,
        };
      }
      const key = item.kind === 'movie' ? `movie:${item.radarrId}` : `series:${item.seriesId}`;
      const status = await coalesce(key, COALESCE_MS, () => scan(plugin, item));
      if (status >= 400) {
        const message = `Bazarr refused the rescan (${status})`;
        return status >= 500 ? { ok: false, retryable: true, message } : { ok: false, message };
      }
      const fresh: BazarrItem | null = await reloadItem(plugin, item);
      if (fresh === null) {
        return {
          ok: false,
          message: `asked Bazarr to rescan ${item.title}, but it no longer lists the item; it updates after its next sync with Sonarr or Radarr`,
        };
      }
      return sameFile(fresh.path, newRemote)
        ? { ok: true, message: `asked Bazarr to rescan ${item.title}; it lists ${newRemote}` }
        : {
            ok: false,
            message: `asked Bazarr to rescan ${item.title}, but it still lists ${fresh.path}; it updates after its next sync with Sonarr or Radarr`,
          };
    } catch (e) {
      const failure = describeFailure(e);
      if (failure === null) throw e;
      return { ok: false, retryable: failure.retryable, message: failure.message };
    }
  },
});

/** B6: `scan-disk` for the series (episodes) or the movie. */
function scan(plugin: PluginContext, item: BazarrItem): Promise<number> {
  const client = bazarrClient(plugin);
  return item.kind === 'movie'
    ? client.patch('/api/movies', { radarrid: String(item.radarrId), action: 'scan-disk' })
    : client.patch('/api/series', { seriesid: String(item.seriesId), action: 'scan-disk' });
}
