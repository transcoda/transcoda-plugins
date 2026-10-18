import { definePlugin, type PluginHooks } from '@transcoda/sdk';
import pkg from '../package.json' with { type: 'json' };
import { integration } from './integration.ts';
import { buildMessage } from './message.ts';
import { notify, publish } from './notify.ts';

export { integration } from './integration.ts';
export { buildMessage, renderTitle, truncateBytes } from './message.ts';
export { notify } from './notify.ts';

export const hooks: PluginHooks = {
  /** Notifies about any workflow's failed job when `notifyOnFailed` is on; errors are thrown, the host logs them. */
  async onJobFailed(ctx, job) {
    if (job.dryRun || ctx.settings.notifyOnFailed !== true) return;
    const topic = ctx.settings.failedTopic;
    const result = await publish(ctx, {
      topic: typeof topic === 'string' && topic !== '' ? topic : 'transcoda',
      title: 'Transcoda: job failed',
      priority: 4,
      tags: ['warning'],
      message: buildMessage({
        workflowName: job.workflowName,
        path: job.path,
        outcome: 'failed',
        beforeBytes: job.beforeBytes,
        afterBytes: job.afterBytes,
        problems: job.problems,
        reason: job.reason,
      }),
      click: job.jobUrl,
    });
    if (!result.ok) throw new Error(result.message);
  },
};

export default definePlugin({
  name: 'ntfy',
  version: pkg.version,
  sdk: pkg.transcoda.sdk,
  integration,
  nodes: [notify],
  hooks,
});
