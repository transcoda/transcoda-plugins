import {
  ArrHttpError,
  arrClient,
  coalesce,
  runCommand,
  sameFile,
} from '@transcoda/plugin-arr-common';
import { defineNode, fetchErrorKind } from '@transcoda/sdk';
import { z } from 'zod';
import { findSeriesForPath, listEpisodeFiles } from './find.ts';

const COALESCE_MS = 5000;

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
  async run(ctx, s) {
    const plugin = ctx.plugin;
    const oldRemote = plugin.paths.toRemote(ctx.originalPath);
    const newRemote = plugin.paths.toRemote(ctx.newPath);
    try {
      let viaNewPath = false;
      let found = await findSeriesForPath(plugin, ctx.originalPath);
      if ((found === null || found.file === null) && ctx.newPath !== ctx.originalPath) {
        // A container change can leave Sonarr without the old entry already; the series is
        // still found by folder, and the rescan is what makes Sonarr list the new file.
        const viaNew = await findSeriesForPath(plugin, ctx.newPath);
        if (viaNew !== null) {
          found = viaNew;
          viaNewPath = true;
        }
      }
      if (found === null || (found.file === null && !viaNewPath)) {
        return { ok: false, message: `Sonarr does not know ${oldRemote}; nothing was rescanned` };
      }
      const { series, episodes } = found;
      const label = episodes === '' ? '' : ` (${episodes})`;
      const missing = episodes === '' ? '' : `; episode ${episodes} may show as missing`;
      const outcome = await coalesce(`series:${series.id}`, COALESCE_MS, () =>
        runCommand(
          plugin,
          arrClient(plugin, 'Sonarr'),
          { name: 'RescanSeries', seriesId: series.id },
          { timeoutMs: s.timeoutSeconds * 1000 },
        ),
      );
      if (outcome.status === 'failed') {
        return {
          ok: false,
          ...(outcome.retryable ? { retryable: true } : {}),
          message: `Sonarr rescan of ${series.title} failed: ${outcome.message}`,
        };
      }
      if (outcome.status === 'timeout') {
        return {
          ok: false,
          retryable: true,
          message: `Sonarr rescan of ${series.title} did not finish within ${s.timeoutSeconds} s`,
        };
      }
      const files = await listEpisodeFiles(plugin, series.id);
      if (files.some((f) => sameFile(f.path, newRemote))) {
        return { ok: true, message: `Sonarr lists ${newRemote}${label}` };
      }
      return {
        ok: false,
        message: `Sonarr does not list ${newRemote} after rescan${missing}`,
      };
    } catch (e) {
      const kind = fetchErrorKind(e);
      if (kind !== null) {
        return {
          ok: false,
          retryable: kind !== 'refused',
          message: `Sonarr unreachable: ${kind}`,
        };
      }
      if (e instanceof ArrHttpError) {
        return { ok: false, retryable: e.status >= 500, message: e.message };
      }
      throw e;
    }
  },
});
