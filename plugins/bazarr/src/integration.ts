import type { JsonValue } from '@transcoda/plugin-arr-common';
import {
  allowInsecureTls,
  defineIntegration,
  fetchErrorKind,
  type IntegrationTestFail,
  type IntegrationTestOk,
  type PluginContext,
  pathMappings,
  secret,
  url,
} from '@transcoda/sdk';
import { z } from 'zod';
import { BazarrHttpError, bazarrClient } from './client.ts';

const MIN_VERSION = [1, 4, 0] as const;

function originOf(ctx: PluginContext): string {
  try {
    return new URL(String(ctx.settings.url ?? '')).origin;
  } catch {
    return 'the configured address';
  }
}

/** B2: `data.bazarr_version` (or `data.version`), leading `v` stripped; null when absent. */
function versionOf(body: JsonValue): string | null {
  const data =
    typeof body === 'object' && body !== null && !Array.isArray(body) ? body.data : undefined;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  for (const field of [data.bazarr_version, data.version]) {
    if (typeof field === 'string' && field.trim() !== '') return field.trim().replace(/^v/i, '');
  }
  return null;
}

/** Numeric parts of `1.5.1` or `1.5.1-beta.2`; null when it does not start like a version. */
function parts(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

function atLeast(version: [number, number, number], min: readonly [number, number, number]) {
  for (let i = 0; i < 3; i++) {
    const a = version[i] ?? 0;
    const b = min[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

async function test(ctx: PluginContext): Promise<IntegrationTestOk | IntegrationTestFail> {
  const origin = originOf(ctx);
  let body: JsonValue;
  try {
    body = await bazarrClient(ctx).get('/api/system/status', undefined, { timeoutMs: 10_000 });
  } catch (e) {
    if (e instanceof BazarrHttpError) {
      if (e.status === 401 || e.status === 403) {
        return { ok: false, kind: 'unauthorized', message: 'Bazarr rejected the API key' };
      }
      return { ok: false, kind: 'other', message: e.message };
    }
    const kind = fetchErrorKind(e);
    if (kind === 'rate-limited') {
      return { ok: false, kind: 'other', message: 'Bazarr is rate limiting requests' };
    }
    if (kind !== null) {
      return {
        ok: false,
        kind: 'unreachable',
        message: `Bazarr is not reachable at ${origin}: ${kind}`,
      };
    }
    throw e;
  }
  const version = versionOf(body);
  const numeric = version === null ? null : parts(version);
  if (version === null || numeric === null) {
    return {
      ok: false,
      kind: 'wrong-product',
      message: 'the address answered, but it is not Bazarr',
    };
  }
  if (!atLeast(numeric, MIN_VERSION)) {
    return {
      ok: false,
      kind: 'too-old',
      message: `Bazarr ${version} is too old; ${MIN_VERSION.join('.')} or newer is required`,
    };
  }
  return { ok: true, message: `Bazarr ${version} at ${origin}`, version };
}

export const integration = defineIntegration({
  id: 'bazarr',
  title: 'Bazarr',
  settings: z.object({
    url: url().describe('Bazarr URL, for example http://bazarr:6767'),
    apiKey: secret().describe('API key (Settings → General → Security)'),
    pathMappings: pathMappings().describe(
      'Paths as Bazarr sees them → paths as Transcoda sees them; leave empty when both see the same folders',
    ),
    timeoutSeconds: z
      .number()
      .int()
      .min(5)
      .max(120)
      .default(30)
      .describe('Timeout per request to Bazarr'),
    allowInsecureTls: allowInsecureTls().describe('Accept a self-signed certificate'),
  }),
  allowedOrigins: ['$settings.url'],
  requires: { product: 'bazarr', minVersion: '1.4.0' },
  test,
});
