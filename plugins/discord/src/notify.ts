import { defineNode } from '@transcoda/sdk';
import { z } from 'zod';
import { buildEmbed } from './embed.ts';
import { integration } from './integration.ts';
import { postMessage } from './post.ts';

// Older cores give FinishRunContext no workflowName; the embed is then titled with the product name.
const FALLBACK_TITLE = 'Transcoda';

const settingsSchema = z.object({
  events: z
    .enum(['done', 'problems-only'])
    .default('done')
    .describe('Post on every finished job, or only when the job needs attention'),
  mentionRoleId: z
    .string()
    .regex(/^\d{5,25}$/)
    .optional()
    .describe('Role id to mention when a job needs attention'),
});

function workflowTitle(ctx: object): string {
  const name = (ctx as { workflowName?: unknown }).workflowName;
  return typeof name === 'string' && name.trim() !== '' ? name : FALLBACK_TITLE;
}

export const notify = defineNode({
  type: 'discord:notify',
  version: 1,
  kind: 'finish',
  finishPhase: 'notify',
  title: 'Notify (Discord)',
  description: 'Posts an embed to a Discord channel through a webhook when the job is done.',
  icon: 'bell',
  inputs: [{ id: 'file', label: 'File', type: 'file' }],
  outputs: [],
  settings: settingsSchema,
  async finish() {
    return {
      actions: [{ kind: 'plugin', description: 'post to Discord', required: false }],
      reason: 'notify after the write',
    };
  },
  async run(ctx, settings) {
    const problems = ctx.problemsSoFar.filter((p) => p.trim() !== '');
    if (settings.events === 'problems-only' && problems.length === 0) {
      return { ok: true, message: 'nothing to report' };
    }
    const account = integration.settings.safeParse(ctx.plugin.settings);
    const username = account.success ? account.data.username : 'Transcoda';
    const result = await postMessage(ctx.plugin, {
      username,
      embed: buildEmbed({
        workflowName: workflowTitle(ctx),
        path: ctx.newPath,
        outcome: ctx.outcome,
        beforeBytes: ctx.beforeBytes,
        afterBytes: ctx.afterBytes,
        problems,
        reason: null,
        jobUrl: ctx.jobUrl,
      }),
      mentionRoleId: problems.length > 0 ? settings.mentionRoleId : undefined,
    });
    if (result.ok) return { ok: true, message: 'posted to Discord' };
    return result.retryable === undefined
      ? { ok: false, message: result.message }
      : { ok: false, retryable: result.retryable, message: result.message };
  },
});
