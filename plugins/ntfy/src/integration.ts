import { defineIntegration, secret, url } from '@transcoda/sdk';
import { z } from 'zod';

const TOPIC = /^[-_A-Za-z0-9]{1,64}$/;

export const integration = defineIntegration({
  id: 'ntfy',
  title: 'ntfy',
  settings: z.object({
    url: url().default('https://ntfy.sh').describe('ntfy server'),
    token: secret().optional().describe('Access token for protected topics (tk_…)'),
    notifyOnFailed: z
      .boolean()
      .default(false)
      .describe('Also notify when a job fails (any workflow)'),
    failedTopic: z.string().regex(TOPIC).default('transcoda').describe('Topic for failed jobs'),
  }),
  allowedOrigins: ['$settings.url'],
  async test(ctx) {
    const base = serverUrl(ctx.settings.url);
    let origin = base;
    try {
      origin = new URL(base).origin;
    } catch {
      // keep the raw value for the message
    }
    try {
      // The token is not used here: a publish would spam a topic, so it is checked on first use.
      const res = await ctx.fetch({ url: `${base}/v1/health`, timeoutMs: 10_000 });
      const body = res.body as { healthy?: unknown } | null;
      if (
        res.status === 200 &&
        body !== null &&
        typeof body === 'object' &&
        body.healthy === true
      ) {
        return { ok: true, message: `ntfy at ${origin} is healthy` };
      }
      return {
        ok: false,
        kind: 'other',
        message: `${origin} did not report a healthy ntfy server (HTTP ${res.status})`,
      };
    } catch (error) {
      const kind = fetchErrorKind(error);
      if (kind !== null) {
        return { ok: false, kind: 'unreachable', message: `ntfy unreachable: ${kind}` };
      }
      throw error;
    }
  },
});

/** The configured server without a trailing slash; the schema default applies when unset. */
export function serverUrl(value: unknown): string {
  const raw = typeof value === 'string' && value !== '' ? value : 'https://ntfy.sh';
  return raw.replace(/\/+$/, '');
}

const FETCH_KINDS: readonly string[] = ['refused', 'timeout', 'rate-limited', 'failed'];

/**
 * The `kind` of a fetch failure, or null for anything else. Never `instanceof`: in a real host the
 * error is built from the host's own SDK copy, not the bundle's, so the class check is always false.
 */
export function fetchErrorKind(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const kind = (error as { kind: unknown }).kind;
    if (typeof kind === 'string' && FETCH_KINDS.includes(kind)) return kind;
  }
  return null;
}
