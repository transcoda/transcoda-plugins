import { rescanAndVerify } from '@transcoda/plugin-arr-common';
import { defineNode } from '@transcoda/sdk';
import { z } from 'zod';
import { findSeriesForPath, listEpisodeFiles } from './find.ts';

export const rescan = defineNode({
  type: 'sonarr:rescan',
  version: 1,
  kind: 'finish',
  finishPhase: 'library-manager',
  title: 'Rescan in Sonarr',
  description:
    'After the file is replaced, rescans its series in Sonarr and checks the file is listed.',
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
          description: 'rescan the series in Sonarr and verify the file is listed',
          required: true,
        },
      ],
      reason: 'rescan after the write',
    };
  },
  async run(ctx, settings) {
    const plugin = ctx.plugin;
    return rescanAndVerify(ctx, 'Sonarr', settings.timeoutSeconds, async (localPath) => {
      const found = await findSeriesForPath(plugin, localPath);
      if (found === null) return null;
      const { series, episodes } = found;
      return {
        hasFile: found.file !== null,
        key: `series:${series.id}`,
        command: { name: 'RescanSeries', seriesId: series.id },
        label: series.title,
        listedSuffix: episodes === '' ? '' : ` (${episodes})`,
        missingSuffix: episodes === '' ? '' : `; episode ${episodes} may show as missing`,
        files: () => listEpisodeFiles(plugin, series.id),
      };
    });
  },
});
