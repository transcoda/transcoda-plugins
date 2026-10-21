import {
  allowInsecureTls,
  defineIntegration,
  fetchErrorKind,
  type IntegrationTestFail,
  type IntegrationTestOk,
  type PluginContext,
  secret,
  url,
} from '@transcoda/sdk';
import { z } from 'zod';
import { seerrGet } from './client.ts';

function originOf(ctx: PluginContext): string {
  try {
    return new URL(String(ctx.settings.url ?? '')).origin;
  } catch {
    return 'the configured address';
  }
}

async function test(ctx: PluginContext): Promise<IntegrationTestOk | IntegrationTestFail> {
  const origin = originOf(ctx);
  const unreachable = (kind: string): IntegrationTestFail =>
    kind === 'rate-limited'
      ? { ok: false, kind: 'other', message: 'Seerr is rate limiting requests' }
      : { ok: false, kind: 'unreachable', message: `Seerr is not reachable at ${origin}: ${kind}` };
  let status: Awaited<ReturnType<typeof seerrGet>>;
  try {
    status = await seerrGet(ctx, '/api/v1/status');
  } catch (e) {
    const kind = fetchErrorKind(e);
    if (kind !== null) return unreachable(kind);
    throw e;
  }
  // S2: /status needs no key. A 5xx is Seerr being unwell, not a different product.
  if (status.status >= 500) {
    return { ok: false, kind: 'other', message: `Seerr answered HTTP ${status.status}` };
  }
  const body = status.body;
  const version =
    typeof body === 'object' && body !== null && !Array.isArray(body) ? body.version : undefined;
  if (status.status < 200 || status.status >= 300 || typeof version !== 'string') {
    return {
      ok: false,
      kind: 'wrong-product',
      message: 'the address answered, but it is not Jellyseerr or Overseerr',
    };
  }
  // S2: /auth/me works with the key alone (no session cookie).
  let me: Awaited<ReturnType<typeof seerrGet>>;
  try {
    me = await seerrGet(ctx, '/api/v1/auth/me');
  } catch (e) {
    const kind = fetchErrorKind(e);
    if (kind !== null) return unreachable(kind);
    throw e;
  }
  if (me.status === 401 || me.status === 403) {
    return { ok: false, kind: 'unauthorized', message: 'Seerr rejected the API key' };
  }
  if (me.status < 200 || me.status >= 300) {
    return { ok: false, kind: 'other', message: `Seerr answered HTTP ${me.status}` };
  }
  return { ok: true, message: `Seerr ${version} at ${origin}`, version };
}

export const integration = defineIntegration({
  id: 'seerr',
  title: 'Seerr (Jellyseerr, Overseerr)',
  settings: z.object({
    url: url().describe('Seerr URL, for example http://jellyseerr:5055'),
    apiKey: secret().describe('API key (Settings → General)'),
    allowInsecureTls: allowInsecureTls().describe('Accept a self-signed certificate'),
  }),
  allowedOrigins: ['$settings.url'],
  test,
});
