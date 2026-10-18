import { defineNode } from '@transcoda/sdk';
import { z } from 'zod';
import { lookupRequest } from './lookup.ts';

export const request = defineNode({
  type: 'seerr:request',
  version: 1,
  kind: 'data',
  title: 'Request (Seerr)',
  description:
    'Whether the title was requested in Jellyseerr or Overseerr, by whom and when. Uses ids from Sonarr or Radarr when connected, else the title.',
  icon: 'user',
  inputs: [
    { id: 'ids', label: 'Ids', type: 'data:ids', required: false },
    { id: 'title', label: 'Title', type: 'data:text', required: false },
  ],
  outputs: [
    { id: 'requested', label: 'Requested', type: 'data:boolean' },
    { id: 'requestedBy', label: 'Requested by', type: 'data:text' },
    { id: 'requestedAt', label: 'Requested at', type: 'data:text' },
  ],
  settings: z.object({
    kind: z.enum(['auto', 'movie', 'tv']).default('auto').describe('What the library holds'),
  }),
  async data(ctx, settings) {
    const { value, reason } = await lookupRequest(ctx.plugin, {
      ids: ctx.data.ids,
      title: ctx.data.title,
      kind: settings.kind,
    });
    return { value, reason };
  },
});
