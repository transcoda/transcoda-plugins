import { defineNode } from '@transcoda/sdk';
import { z } from 'zod';
import { describeFailure } from './client.ts';
import { findItem, kindSetting } from './find.ts';
import { EMBEDDED_CAVEAT, includeSetting, summary } from './subtitles.ts';

export const subtitlesPresent = defineNode({
  type: 'bazarr:subtitles-present',
  version: 1,
  kind: 'condition',
  title: 'Has subtitles (Bazarr)',
  description: `Yes when Bazarr lists a subtitle for every chosen language. ${EMBEDDED_CAVEAT}.`,
  icon: 'languages',
  inputs: [{ id: 'file', label: 'File', type: 'file' }],
  outputs: [
    { id: 'pass', label: 'Yes', type: 'file' },
    { id: 'else', label: 'No', type: 'file' },
  ],
  settings: z.object({
    languages: z
      .array(z.string().regex(/^[a-z]{3}$/))
      .min(1)
      .describe('Languages (eng, deu)'),
    kind: kindSetting(),
    include: includeSetting(),
  }),
  async decide(ctx, settings) {
    const plugin = ctx.plugin;
    const remote = plugin.paths.toRemote(ctx.file.path);
    try {
      const item = await findItem(plugin, ctx.file.path, settings.kind);
      if (item === null) return { port: 'else', reason: `Bazarr does not know ${remote}` };
      const have = new Set(summary(item.subtitles, settings.include).languages);
      const wanted = settings.languages.map((l) => plugin.lang.toIso3(l) ?? l);
      const missing = wanted.filter((l) => !have.has(l));
      return missing.length === 0
        ? { port: 'pass', reason: `Bazarr has ${wanted.join(', ')}` }
        : { port: 'else', reason: `Bazarr has no ${missing.join(', ')} subtitle` };
    } catch (e) {
      const failure = describeFailure(e);
      if (failure === null) throw e;
      return { port: 'else', reason: failure.message };
    }
  },
});
