import {
  describeFailure,
  idsOf,
  notKnownMessage,
  originalLanguageOf,
} from '@transcoda/plugin-arr-common';
import { defineNode } from '@transcoda/sdk';
import { z } from 'zod';
import { findMovie, movieLabel } from './find.ts';

const UNKNOWN = { language: 'unknown', title: 'unknown', ids: 'unknown' } as const;

export const originalLanguage = defineNode({
  type: 'radarr:original-language',
  version: 1,
  kind: 'data',
  title: 'Original language (Radarr)',
  description:
    "Looks the file up in Radarr and outputs the movie's original language, title and ids.",
  icon: 'languages',
  inputs: [],
  outputs: [
    { id: 'language', label: 'Original language', type: 'data:language' },
    { id: 'title', label: 'Movie title', type: 'data:text' },
    { id: 'ids', label: 'Ids', type: 'data:ids' },
  ],
  settings: z.object({}),
  async data(ctx, _settings) {
    const remotePath = ctx.plugin.paths.toRemote(ctx.file.path);
    try {
      const movie = await findMovie(ctx.plugin, remotePath);
      if (movie === null) {
        return {
          value: { ...UNKNOWN },
          reason: await notKnownMessage(ctx.plugin, 'Radarr', remotePath),
        };
      }
      const label = movieLabel(movie);
      const lang = originalLanguageOf(ctx.plugin, {
        originalLanguage: movie.originalLanguage ?? null,
      });
      return {
        value: { language: lang.language, title: label, ids: idsOf({ ...movie }) },
        reason: `${label}: ${lang.reason}`,
      };
    } catch (e) {
      // Never throws for an expected failure, so the trace shows the reason.
      const failure = describeFailure('Radarr', e);
      if (failure === null) throw e;
      return { value: { ...UNKNOWN }, reason: failure.message };
    }
  },
});
