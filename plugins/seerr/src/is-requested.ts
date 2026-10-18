import { defineNode } from '@transcoda/sdk';
import { z } from 'zod';
import { lookupRequest } from './lookup.ts';

export const isRequested = defineNode({
  type: 'seerr:is-requested',
  version: 1,
  kind: 'condition',
  title: 'Was requested (Seerr)',
  description: 'Yes when someone requested the title in Jellyseerr or Overseerr.',
  icon: 'user',
  inputs: [
    { id: 'file', label: 'File', type: 'file' },
    { id: 'ids', label: 'Ids', type: 'data:ids', required: false },
    { id: 'title', label: 'Title', type: 'data:text', required: false },
  ],
  outputs: [
    { id: 'pass', label: 'Yes', type: 'file' },
    { id: 'else', label: 'No', type: 'file' },
  ],
  settings: z.object({
    kind: z.enum(['auto', 'movie', 'tv']).default('auto').describe('What the library holds'),
    whenUnknown: z.enum(['yes', 'no']).default('no').describe('When Seerr cannot tell'),
  }),
  async decide(ctx, settings) {
    const { value, reason } = await lookupRequest(ctx.plugin, {
      ids: ctx.data.ids,
      title: ctx.data.title,
      kind: settings.kind,
    });
    if (value.requested === true) {
      return {
        port: 'pass',
        reason,
        findings: { requestedBy: value.requestedBy, requestedAt: value.requestedAt },
      };
    }
    if (value.requested === false) return { port: 'else', reason };
    return { port: settings.whenUnknown === 'yes' ? 'pass' : 'else', reason };
  },
});
