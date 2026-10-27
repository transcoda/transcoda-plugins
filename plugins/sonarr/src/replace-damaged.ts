import { arrClient, replaceDamagedFile } from '@transcoda/plugin-arr-common';
import { defineNode } from '@transcoda/sdk';
import { z } from 'zod';
import { findSeriesForPath } from './find.ts';

export const replaceDamaged = defineNode({
  type: 'sonarr:replace-damaged',
  version: 1,
  kind: 'finish',
  finishPhase: 'library-manager',
  damagedOnly: true,
  title: 'Replace damaged file (Sonarr)',
  description:
    'After a damaged source: blocklists the release, deletes the file through Sonarr and searches for a new copy. Only on a Damaged output.',
  icon: 'refresh',
  inputs: [{ id: 'file', label: 'File', type: 'file' }],
  outputs: [],
  settings: z.object({}),
  async finish() {
    return {
      actions: [
        {
          kind: 'plugin',
          description: 'blocklist the release, delete the file and search in Sonarr',
          required: true,
        },
      ],
      reason: 'replace the damaged file after the walk',
    };
  },
  async run(ctx) {
    const plugin = ctx.plugin;
    return replaceDamagedFile(ctx, 'Sonarr', arrClient(plugin, 'Sonarr'), async () => {
      const found = await findSeriesForPath(plugin, ctx.originalPath, { strictEpisodes: true });
      if (found === null || found.file === null || found.episodeIds.length === 0) return null;
      const { series, file, episodes, episodeIds } = found;
      return {
        label: `${series.title} ${episodes}`,
        historyPath: `/api/v3/history/series?seriesId=${series.id}`,
        episodeIds,
        blocklist: { seriesId: series.id, episodeIds },
        remotePath: file.path,
        deletePath: `/api/v3/episodefile/${file.id}`,
        search: { name: 'EpisodeSearch', episodeIds },
      };
    });
  },
});
