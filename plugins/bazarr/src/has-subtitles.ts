import { defineNode, type PluginContext } from '@transcoda/sdk';
import { z } from 'zod';
import { describeFailure } from './client.ts';
import { findItem, kindSetting } from './find.ts';
import { includeSetting, summary } from './subtitles.ts';

const UNKNOWN = { languages: 'unknown', forced: 'unknown', sdh: 'unknown' } as const;

export const hasSubtitles = defineNode({
  type: 'bazarr:has-subtitles',
  version: 1,
  kind: 'data',
  title: 'Subtitles in Bazarr',
  description:
    'Looks the file up in Bazarr and outputs the subtitle languages it has, and whether any is forced or SDH.',
  icon: 'languages',
  inputs: [],
  outputs: [
    { id: 'languages', label: 'Subtitle languages', type: 'data:languages' },
    { id: 'forced', label: 'Has forced', type: 'data:boolean' },
    { id: 'sdh', label: 'Has SDH', type: 'data:boolean' },
  ],
  settings: z.object({ kind: kindSetting(), include: includeSetting() }),
  async data(ctx, settings) {
    const plugin: PluginContext = ctx.plugin;
    const remote = plugin.paths.toRemote(ctx.file.path);
    try {
      const item = await findItem(plugin, ctx.file.path, settings.kind);
      if (item === null) return { value: UNKNOWN, reason: `Bazarr does not know ${remote}` };
      const found = summary(item.subtitles, settings.include);
      const flags = [found.forced ? 'forced' : '', found.sdh ? 'SDH' : ''].filter((f) => f !== '');
      const list = found.languages.length > 0 ? found.languages.join(', ') : 'no subtitles';
      return {
        value: found,
        reason: `${item.title}: ${list}${flags.length > 0 ? ` (${flags.join(', ')})` : ''}`,
      };
    } catch (e) {
      const failure = describeFailure(e);
      if (failure === null) throw e;
      return { value: UNKNOWN, reason: failure.message };
    }
  },
});
