import { ArrHttpError, fetchKindOf, originalLanguageOf } from '@transcoda/plugin-arr-common';
import { defineNode } from '@transcoda/sdk';
import { z } from 'zod';
import { findSeriesForPath, idsOfSeries } from './find.ts';

const UNKNOWN = { language: 'unknown', title: 'unknown', ids: 'unknown' } as const;

export const originalLanguage = defineNode({
  type: 'sonarr:original-language',
  version: 1,
  kind: 'data',
  title: 'Original language (Sonarr)',
  description:
    "Looks the file up in Sonarr and outputs the series' original language, title and ids.",
  icon: 'languages',
  inputs: [],
  outputs: [
    { id: 'language', label: 'Original language', type: 'data:language' },
    { id: 'title', label: 'Series title', type: 'data:text' },
    { id: 'ids', label: 'Ids', type: 'data:ids' },
  ],
  settings: z.object({}),
  async data(ctx) {
    const remote = ctx.plugin.paths.toRemote(ctx.file.path);
    try {
      const found = await findSeriesForPath(ctx.plugin, ctx.file.path, { lookupFile: false });
      if (found === null) {
        return { value: { ...UNKNOWN }, reason: `Sonarr does not know ${remote}` };
      }
      const { series } = found;
      const lang = originalLanguageOf(
        ctx.plugin,
        series.originalLanguage ? { originalLanguage: series.originalLanguage } : {},
      );
      return {
        value: { language: lang.language, title: series.title, ids: idsOfSeries(series) },
        reason: `${series.title}: ${lang.reason}`,
      };
    } catch (e) {
      const kind = fetchKindOf(e);
      if (kind !== null) {
        return { value: { ...UNKNOWN }, reason: `Sonarr unreachable: ${kind}` };
      }
      if (e instanceof ArrHttpError) return { value: { ...UNKNOWN }, reason: e.message };
      throw e;
    }
  },
});
