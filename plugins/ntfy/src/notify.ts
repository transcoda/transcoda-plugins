import {
  defineNode,
  type FinishRunContext,
  type FinishRunResult,
  type PluginContext,
} from '@transcoda/sdk';
import { z } from 'zod';
import { fetchErrorKind, serverUrl } from './integration.ts';
import { basename, buildMessage, renderTitle } from './message.ts';

const TOPIC = /^[-_A-Za-z0-9]{1,64}$/;

export interface Publish {
  topic: string;
  message: string;
  title: string;
  priority: number;
  tags: string[];
  click?: string | null | undefined;
}

export type PublishOutcome = { ok: true } | { ok: false; message: string; retryable: boolean };

/** One JSON publish to the configured server; the token travels only in `auth.bearer`. */
export async function publish(plugin: PluginContext, p: Publish): Promise<PublishOutcome> {
  const token = plugin.settings.token;
  const body = {
    topic: p.topic,
    message: p.message,
    title: p.title,
    priority: p.priority,
    tags: p.tags,
    ...(typeof p.click === 'string' ? { click: p.click } : {}),
  };
  try {
    const res = await plugin.fetch({
      url: `${serverUrl(plugin.settings.url)}/`,
      method: 'POST',
      body,
      timeoutMs: 10_000,
      accept: 'none',
      ...(typeof token === 'string' && token !== '' ? { auth: { bearer: token } } : {}),
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    if (res.status === 429) {
      return { ok: false, retryable: false, message: 'ntfy rate limited' };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, retryable: false, message: `ntfy rejected the token for ${p.topic}` };
    }
    if (res.status === 413) {
      return { ok: false, retryable: false, message: 'ntfy refused the message as too large' };
    }
    return { ok: false, retryable: false, message: `ntfy answered ${res.status}` };
  } catch (error) {
    const kind = fetchErrorKind(error);
    if (kind !== null) {
      if (kind === 'rate-limited') {
        return { ok: false, retryable: false, message: 'ntfy rate limited' };
      }
      return {
        ok: false,
        retryable: kind === 'timeout',
        message: `ntfy unreachable: ${kind}`,
      };
    }
    throw error;
  }
}

function outcomeWord(ctx: FinishRunContext): string {
  return ctx.problemsSoFar.length > 0 ? `${ctx.outcome} · needs attention` : ctx.outcome;
}

/** The host's workflow name; "job" only for an older core whose run context lacks it. */
function workflowNameOf(ctx: FinishRunContext): string {
  const name = (ctx as { workflowName?: unknown }).workflowName;
  return typeof name === 'string' && name !== '' ? name : 'job';
}

export const notify = defineNode({
  type: 'ntfy:notify',
  version: 1,
  kind: 'finish',
  finishPhase: 'notify',
  title: 'Notify (ntfy)',
  description: 'Sends a push through ntfy when the job is done.',
  icon: 'bell',
  inputs: [{ id: 'file', label: 'File', type: 'file' }],
  outputs: [],
  settings: z.object({
    topic: z.string().regex(TOPIC).describe('Topic'),
    title: z
      .string()
      .max(200)
      .default('Transcoda: {{workflow}}')
      .describe('Title; {{workflow}}, {{file}} and {{outcome}} are replaced'),
    priority: z.number().int().min(1).max(5).default(3).describe('1 = min … 5 = urgent'),
    tags: z.array(z.string().max(40)).max(10).default([]).describe('ntfy tags (emoji short codes)'),
    events: z
      .enum(['done', 'problems-only'])
      .default('done')
      .describe('Send on every finished job, or only when the job needs attention'),
  }),
  async finish(_ctx, settings) {
    return {
      actions: [
        {
          kind: 'plugin',
          description: `notify ${settings.topic} through ntfy`,
          required: false,
        },
      ],
      reason: 'notify after the write',
    };
  },
  async run(ctx, settings): Promise<FinishRunResult> {
    if (settings.events === 'problems-only' && ctx.problemsSoFar.length === 0) {
      return { ok: true, message: 'no problems; nothing sent' };
    }
    const outcome = outcomeWord(ctx);
    const message = buildMessage({
      workflowName: workflowNameOf(ctx),
      path: ctx.newPath,
      outcome,
      beforeBytes: ctx.beforeBytes,
      afterBytes: ctx.afterBytes,
      problems: ctx.problemsSoFar,
      reason: null,
    });
    const result = await publish(ctx.plugin, {
      topic: settings.topic,
      message,
      title: renderTitle(settings.title, {
        workflow: workflowNameOf(ctx),
        file: basename(ctx.newPath),
        outcome,
      }),
      priority: settings.priority,
      tags: settings.tags,
      click: ctx.jobUrl,
    });
    if (result.ok) return { ok: true, message: `sent to ${settings.topic}` };
    return { ok: false, message: result.message, retryable: result.retryable };
  },
});
