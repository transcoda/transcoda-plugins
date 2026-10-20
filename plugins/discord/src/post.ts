import { fetchErrorKind, type PluginContext, type PluginFetchResponse } from '@transcoda/sdk';
import type { Embed } from './embed.ts';

type JsonValue = PluginFetchResponse['body'];

// The host proxy already retries a 429 once on Retry-After and reports a second one as
// FetchRateLimited, and one timeoutMs deadline covers the whole call, so the plugin does not retry.
// 70 s leaves room for the longest Retry-After the proxy honours.
const POST_TIMEOUT_MS = 70_000;

/** The fetch error kind, or 'failed' for anything else. Never reads the message (it may hold the URL). */
export function errorKind(e: unknown): string {
  return fetchErrorKind(e) ?? 'failed';
}

export type PostResult = { ok: true } | { ok: false; message: string; retryable?: boolean };

const RATE_LIMITED = 'Discord rate limit; try again later';

export interface Message {
  username: string;
  embed: Embed;
  /** Role to mention (only passed when the job needs attention). */
  mentionRoleId?: string | undefined;
}

function payload(m: Message): JsonValue {
  const roles = m.mentionRoleId === undefined ? [] : [m.mentionRoleId];
  const body: Record<string, JsonValue> = {
    username: m.username,
    embeds: [m.embed as unknown as JsonValue],
    allowed_mentions: { parse: [], roles },
  };
  if (m.mentionRoleId !== undefined) body.content = `<@&${m.mentionRoleId}>`;
  return body;
}

/** POSTs to the webhook once; no message ever contains the URL. */
export async function postMessage(ctx: PluginContext, m: Message): Promise<PostResult> {
  const url = String(ctx.settings.webhookUrl ?? '');
  let res: PluginFetchResponse;
  try {
    res = await ctx.fetch({
      url,
      method: 'POST',
      body: payload(m),
      timeoutMs: POST_TIMEOUT_MS,
      accept: 'none',
    });
  } catch (e) {
    const kind = errorKind(e);
    if (kind === 'rate-limited') return { ok: false, message: RATE_LIMITED };
    return { ok: false, retryable: kind === 'timeout', message: `Discord unreachable: ${kind}` };
  }
  if (res.status >= 200 && res.status < 300) return { ok: true };
  if (res.status === 429) return { ok: false, message: RATE_LIMITED };
  if (res.status === 401 || res.status === 404) {
    return { ok: false, message: 'Discord does not know this webhook' };
  }
  return { ok: false, message: `Discord answered ${res.status}` };
}
