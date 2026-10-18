import { defineNode } from '@transcoda/sdk';
import { z } from 'zod';
import { lookupOriginalLanguage } from './lookup.ts';

export const originalLanguage = defineNode({
  type: 'tmdb:original-language',
  version: 1,
  kind: 'data',
  title: 'Original language (TMDB)',
  description:
    'Looks the title up on TMDB and outputs its original language. Uses ids from Sonarr or Radarr when connected, else the title, else the file name.',
  icon: 'languages',
  inputs: [
    { id: 'ids', label: 'Ids', type: 'data:ids', required: false },
    { id: 'title', label: 'Title', type: 'data:text', required: false },
  ],
  outputs: [{ id: 'language', label: 'Original language', type: 'data:language' }],
  settings: z.object({
    kind: z.enum(['auto', 'movie', 'tv']).default('auto').describe('What the library holds'),
  }),
  async data(ctx, settings) {
    const { language, reason } = await lookupOriginalLanguage(ctx.plugin, {
      ids: ctx.data.ids,
      title: ctx.data.title,
      file: { path: ctx.file.path },
      kind: settings.kind,
    });
    return { value: language, reason };
  },
});
