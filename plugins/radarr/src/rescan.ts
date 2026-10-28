import {
  arrClient,
  coalesce,
  type JsonValue,
  notKnownMessage,
  runCommand,
  sameFile,
} from '@transcoda/plugin-arr-common';
import { defineNode } from '@transcoda/sdk';
import { z } from 'zod';
import { describeFailure } from './errors.ts';
import { findMovieForPath, movieFiles, movieLabel } from './find.ts';

const COALESCE_MS = 5000;

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
    try {
      const found = await findMovieForPath(plugin, ctx.originalPath);
      if (found === null || found.file === null) {
        const unknown = await notKnownMessage(
          plugin,
          'Radarr',
          plugin.paths.toRemote(ctx.originalPath),
        );
        return { ok: false, message: `${unknown}; nothing was rescanned` };
      }
      const { movie } = found;
      const label = movieLabel(movie);
      const client = arrClient(plugin, 'Radarr');
      const body: { name: string } & Record<string, JsonValue> = {
        name: 'RescanMovie',
        movieId: movie.id,
      };
      const outcome = await coalesce(`movie:${movie.id}`, COALESCE_MS, () =>
        runCommand(plugin, client, body, { timeoutMs: settings.timeoutSeconds * 1000 }),
      );
      if (outcome.status === 'failed') {
        return { ok: false, message: `Radarr rescan of ${label} failed: ${outcome.message}` };
      }
      if (outcome.status === 'timeout') {
        return {
          ok: false,
          retryable: true,
          message: `Radarr rescan of ${label} did not finish within ${settings.timeoutSeconds} s`,
        };
      }
      const newRemote = plugin.paths.toRemote(ctx.newPath);
      const listed = (await movieFiles(plugin, movie.id)).some((f) => sameFile(f.path, newRemote));
      return listed
        ? { ok: true, message: `Radarr lists ${newRemote} (${label})` }
        : {
            ok: false,
            message: `Radarr does not list ${newRemote} after rescan; ${label} may show as missing`,
          };
    } catch (e) {
      const failure = describeFailure(e);
      if (failure === null) throw e;
      return { ok: false, retryable: failure.retryable, message: failure.message };
    }
  },
});
