import { defineIntegration, fetchErrorKind, secret } from '@transcoda/sdk';
import { z } from 'zod';

const WEBHOOK_SHAPE = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;

export function webhookShape(url: string): boolean {
  return WEBHOOK_SHAPE.test(url);
}

export const integration = defineIntegration({
  id: 'discord',
  title: 'Discord',
  settings: z.object({
    webhookUrl: secret().describe(
      'Webhook URL (Server settings → Integrations → Webhooks); the whole URL is the secret',
    ),
    notifyOnFailed: z
      .boolean()
      .default(false)
      .describe('Also notify when a job fails (any workflow)'),
    username: z
      .string()
      .min(1)
      .max(80)
      .default('Transcoda')
      .describe('Name the message is posted as'),
  }),
  allowedOrigins: ['https://discord.com'],
  async test(ctx) {
    const url = String(ctx.settings.webhookUrl ?? '');
    if (!webhookShape(url)) {
      return {
        ok: false,
        kind: 'other',
        message: 'The webhook URL must look like https://discord.com/api/webhooks/<id>/<token>',
      };
    }
    try {
      // The URL itself is the tokenised secret: the host tokenises it and the proxy substitutes it.
      const res = await ctx.fetch({ url, method: 'GET', accept: 'json', timeoutMs: 10_000 });
      if (res.status === 401 || res.status === 404) {
        return { ok: false, kind: 'unauthorized', message: 'Discord does not know this webhook' };
      }
      if (res.status !== 200) {
        return { ok: false, kind: 'other', message: `Discord answered ${res.status}` };
      }
      const body = res.body;
      if (
        typeof body !== 'object' ||
        body === null ||
        Array.isArray(body) ||
        typeof body.name !== 'string'
      ) {
        return { ok: false, kind: 'other', message: 'Discord answered, but not like a webhook' };
      }
      return {
        ok: true,
        message: `Webhook "${body.name}" in channel ${String(body.channel_id ?? 'unknown')}`,
      };
    } catch (e) {
      const kind = fetchErrorKind(e);
      if (kind === null) throw e;
      return { ok: false, kind: 'unreachable', message: `Discord unreachable: ${kind}` };
    }
  },
});
