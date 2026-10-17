import {
  allowInsecureTls,
  defineIntegration,
  FetchError,
  type IntegrationTestFail,
  type IntegrationTestOk,
  type PluginContext,
  pathMappings,
  secret,
  url,
} from '@transcoda/sdk';
import { z } from 'zod';
import { jellyfinBase, jellyfinGet, LEGACY_HEADER_WARNING, usesLegacyHeader } from './auth.ts';

/** Jan's server: Jellyfin sees /shows and /movies, Transcoda sees /data/shows and /data/movies. */
export const DEFAULT_MAPPINGS = [
  { local: '/data/shows', remote: '/shows' },
  { local: '/data/movies', remote: '/movies' },
];

function field(body: unknown, key: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const v = (body as Record<string, unknown>)[key];
  return typeof v === 'string' && v !== '' ? v : null;
}

async function test(ctx: PluginContext): Promise<IntegrationTestOk | IntegrationTestFail> {
  const base = jellyfinBase(ctx);
  let origin = base;
  try {
    origin = new URL(base).origin;
  } catch {
    // keep the raw value; the settings schema already validated it as a url
  }
  try {
    const pub = await ctx.fetch({ url: `${base}/System/Info/Public`, accept: 'json' });
    if (pub.status !== 200) {
      return {
        ok: false,
        kind: 'other',
        message: `Jellyfin at ${origin} answered ${pub.status}`,
      };
    }
    if (field(pub.body, 'Version') === null) {
      return {
        ok: false,
        kind: 'wrong-product',
        message: `The server at ${origin} does not look like Jellyfin`,
      };
    }
    const info = await jellyfinGet(ctx, '/System/Info');
    if (info.status === 401 || info.status === 403) {
      return { ok: false, kind: 'unauthorized', message: 'Jellyfin rejected the API key' };
    }
    if (info.status !== 200) {
      return {
        ok: false,
        kind: 'other',
        message: `Jellyfin answered ${info.status} to the system info request`,
      };
    }
    const version = field(info.body, 'Version') ?? field(pub.body, 'Version') ?? 'unknown';
    const name = field(info.body, 'ServerName') ?? field(pub.body, 'ServerName');
    return {
      ok: true,
      message: name === null ? `Jellyfin ${version}` : `Jellyfin ${version} (${name})`,
      version,
      warnings: (await usesLegacyHeader(ctx)) ? [LEGACY_HEADER_WARNING] : [],
    };
  } catch (e) {
    if (e instanceof FetchError) {
      return {
        ok: false,
        kind: 'unreachable',
        message: `Jellyfin is not reachable at ${origin}: ${e.kind}`,
      };
    }
    throw e;
  }
}

export const integration = defineIntegration({
  id: 'jellyfin',
  title: 'Jellyfin',
  settings: z.object({
    url: url().describe('Jellyfin URL, for example http://jellyfin:8096'),
    apiKey: secret().describe('API key (Dashboard → API Keys)'),
    pathMappings: pathMappings()
      .default(DEFAULT_MAPPINGS)
      .describe(
        'Paths as Transcoda sees them → paths as Jellyfin sees them, for example /data/shows → /shows',
      ),
    allowInsecureTls: allowInsecureTls(),
  }),
  allowedOrigins: ['$settings.url'],
  requires: { product: 'jellyfin', minVersion: '10.8.0' },
  test,
});
