import { rescanAndVerify } from '@transcoda/plugin-arr-common';
import { defineNode } from '@transcoda/sdk';
import { z } from 'zod';
import { findMovieForPath, movieFiles, movieLabel } from './find.ts';

export const rescan = defineNode({
  type: 'radarr:rescan',
  version: 1,
  kind: 'finish',
  finishPhase: 'library-manager',
  title: 'Rescan in Radarr',
  description:
    'After the file is replaced, rescans its movie in Radarr and checks the file is listed.',
  icon: 'refresh',
  inputs: [{ id: 'file', label: 'File', type: 'file' }],
  outputs: [],
  settings: z.object({
    timeoutSeconds: z
      .number()
      .int()
      .min(30)
      .max(600)
      .default(240)
      .describe('How long to wait for the rescan'),
  }),
  async finish() {
    return {
      actions: [
        {
          kind: 'plugin',
          description: 'rescan the movie in Radarr and verify the file is listed',
          required: true,
        },
      ],
      reason: 'rescan after the write',
    };
  },
  async run(ctx, settings) {
    const plugin = ctx.plugin;
    return rescanAndVerify(ctx, 'Radarr', settings.timeoutSeconds, async (localPath) => {
      const found = await findMovieForPath(plugin, localPath);
      if (found === null) return null;
      const { movie } = found;
      const label = movieLabel(movie);
      return {
        hasFile: found.file !== null,
        key: `movie:${movie.id}`,
        command: { name: 'RescanMovie', movieId: movie.id },
        label,
        listedSuffix: ` (${label})`,
        missingSuffix: `; ${label} may show as missing`,
        files: () => movieFiles(plugin, movie.id),
      };
    });
  },
});
