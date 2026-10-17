import { definePlugin, type HookJob, type PluginContext, type PluginHooks } from '@transcoda/sdk';
import pkg from '../package.json' with { type: 'json' };
import { buildEmbed } from './embed.ts';
import { integration } from './integration.ts';
import { notify } from './notify.ts';
import { postMessage } from './post.ts';

export { buildEmbed } from './embed.ts';
export { integration, webhookShape } from './integration.ts';
export { notify } from './notify.ts';

export const hooks: PluginHooks = {
  async onJobFailed(ctx: PluginContext, job: HookJob) {
    const account = integration.settings.safeParse(ctx.settings);
    if (!account.success || !account.data.notifyOnFailed) return;
    const result = await postMessage(ctx, {
      username: account.data.username,
      embed: buildEmbed({
        workflowName: job.workflowName,
        path: job.path,
        outcome: 'failed',
        beforeBytes: job.beforeBytes,
        afterBytes: job.afterBytes,
        problems: job.problems,
        reason: job.reason,
        jobUrl: job.jobUrl,
      }),
    });
    if (!result.ok) await ctx.log('warn', result.message);
  },
};

export default definePlugin({
  name: 'discord',
  version: pkg.version,
  sdk: pkg.transcoda.sdk,
  integration,
  nodes: [notify],
  hooks,
});
