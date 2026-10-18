import { defineNode, fetchErrorKind, type PluginContext } from '@transcoda/sdk';
import { z } from 'zod';
import { bazarrClient, describeFailure } from './client.ts';
import { type BazarrItem, findItem, kindSetting, reloadItem } from './find.ts';

const POLL_MS = 3000;
/** The plugin call limit is 30 s; 25 s of waiting leaves room for the last request. */
const MAX_WAIT_SECONDS = 25;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** B5: one language of one item. Bazarr takes the 2-letter code; movies and episodes differ. */
function patchFor(item: BazarrItem, language: string, forced: boolean, hi: boolean) {
  const flags = { language, forced: forced ? 'True' : 'False', hi: hi ? 'True' : 'False' };
  return item.kind === 'movie'
    ? { path: '/api/movies/subtitles', query: { radarrid: String(item.radarrId), ...flags } }
    : {
        path: '/api/episodes/subtitles',
        query: { seriesid: String(item.seriesId), episodeid: String(item.episodeId), ...flags },
      };
}

export const getSubtitlesNow = defineNode({
  type: 'bazarr:get-subtitles-now',
  version: 1,
  kind: 'action',
  title: 'Get subtitles now (Bazarr)',
  description:
    'Asks Bazarr to download missing subtitles for this file and waits a little for them, so "Embed subtitle files" after it can add them. Best effort: the workflow continues without them.',
  icon: 'download',
  inputs: [{ id: 'file', label: 'File', type: 'file' }],
  outputs: [{ id: 'file', label: 'File', type: 'file' }],
  settings: z.object({
    languages: z
      .array(z.string().regex(/^[a-z]{2}$/))
      .min(1)
      .describe('Languages to fetch, as Bazarr codes (en, de)'),
    forced: z.boolean().default(false).describe('Forced subtitles'),
    hi: z.boolean().default(false).describe('Hearing-impaired subtitles'),
    waitSeconds: z
      .number()
      .int()
      .min(5)
      .max(MAX_WAIT_SECONDS)
      .default(MAX_WAIT_SECONDS)
      .describe(
        'How long to wait for Bazarr, in seconds. At most 25: a plugin call may take 30 s, and the lookups and the last check come out of that time',
      ),
    kind: kindSetting(),
  }),
  // The model always comes back unchanged: sidecar files are added later by core's own node.
  async build(ctx, settings) {
    const { model } = ctx;
    const plugin: PluginContext = ctx.plugin;
    if (plugin.dryRun) {
      return { model, reason: `dry run: would ask Bazarr for ${settings.languages.join(', ')}` };
    }
    const remote = plugin.paths.toRemote(ctx.file.path);
    const waitSeconds = Math.min(settings.waitSeconds, MAX_WAIT_SECONDS);
    // Every request, lookups included, is capped by what is left of the budget.
    const deadline = Date.now() + waitSeconds * 1000;
    const budget = () => ({ timeoutMs: Math.max(1000, deadline - Date.now()) });
    try {
      const item = await findItem(plugin, ctx.file.path, settings.kind, budget);
      if (item === null) {
        return {
          model,
          reason: `Bazarr does not know ${remote}; continuing without new subtitles`,
        };
      }
      // A track already inside the video counts too: asking again would only leave a new file
      // next to it that the embed node then skips (re-runs of a replaced file).
      const listed = (current: BazarrItem, bazarrCode: string) => {
        const iso3 = plugin.lang.toIso3(bazarrCode) ?? bazarrCode;
        return current.subtitles.some(
          (s) => s.language === iso3 && s.forced === settings.forced && s.sdh === settings.hi,
        );
      };
      const wanted = settings.languages.filter((l) => !listed(item, l));
      if (wanted.length === 0) {
        return { model, reason: `Bazarr already has ${settings.languages.join(', ')}` };
      }

      const client = bazarrClient(plugin);
      const sent = await Promise.allSettled(
        wanted.map((language) => {
          const { path, query } = patchFor(item, language, settings.forced, settings.hi);
          return client.patch(path, query, budget());
        }),
      );
      for (const result of sent) {
        // B5: whatever Bazarr answers, the result is what it lists afterwards; only a timeout is expected.
        if (result.status === 'rejected' && fetchErrorKind(result.reason) !== 'timeout') {
          throw result.reason;
        }
      }

      // A synchronous PATCH may have finished the download: look once before sleeping.
      let current: BazarrItem = (await reloadItem(plugin, item, budget)) ?? item;
      while (wanted.some((l) => !listed(current, l))) {
        const left = deadline - Date.now();
        if (left <= 0) break;
        await sleep(Math.min(POLL_MS, left));
        current = (await reloadItem(plugin, current, budget)) ?? current;
      }

      const got = wanted.filter((l) => listed(current, l));
      const lacking = wanted.filter((l) => !listed(current, l));
      const parts = [
        ...(got.length > 0 ? [`Bazarr downloaded ${got.join(', ')}`] : []),
        ...(lacking.length > 0
          ? [
              `Bazarr found no ${lacking.join(', ')} subtitle within ${waitSeconds} s; continuing without`,
            ]
          : []),
      ];
      return { model, reason: parts.join('; ') };
    } catch (e) {
      const failure = describeFailure(e);
      if (failure === null) throw e;
      return { model, reason: `${failure.message}; continuing without new subtitles` };
    }
  },
});
