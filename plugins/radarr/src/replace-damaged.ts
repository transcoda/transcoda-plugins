import { arrClient, replaceDamagedFile } from '@transcoda/plugin-arr-common';
import { defineNode } from '@transcoda/sdk';
import { z } from 'zod';
import { findMovieForPath, movieLabel } from './find.ts';

export const replaceDamaged = defineNode({
  type: 'radarr:replace-damaged',
  version: 1,
  kind: 'finish',
  finishPhase: 'library-manager',
  damagedOnly: true,
  title: 'Replace damaged file (Radarr)',
  description:
    'After a damaged source: blocklists the release, deletes the file through Radarr and searches for a new copy. Only on a Damaged output.',
  icon: 'refresh',
  inputs: [{ id: 'file', label: 'File', type: 'file' }],
  outputs: [],
  settings: z.object({}),
  async finish() {
    return {
      actions: [
        {
          kind: 'plugin',
          description: 'blocklist the release, delete the file and search in Radarr',
          required: true,
        },
      ],
      reason: 'replace the damaged file after the walk',
    };
  },
  async run(ctx) {
    const plugin = ctx.plugin;
    return replaceDamagedFile(ctx, 'Radarr', arrClient(plugin, 'Radarr'), async () => {
      const found = await findMovieForPath(plugin, ctx.originalPath);
      if (found === null || found.file === null) return null;
      const { movie, file } = found;
      return {
        label: movieLabel(movie),
        historyPath: `/api/v3/history/movie?movieId=${movie.id}`,
        blocklist: { movieId: movie.id },
        remotePath: file.path,
        deletePath: `/api/v3/moviefile/${file.id}`,
        search: { name: 'MoviesSearch', movieIds: [movie.id] },
      };
    });
  },
});
