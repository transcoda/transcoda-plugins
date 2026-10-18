import {
  ArrHttpError,
  arrClient,
  testStatus,
  unmonitorWarning,
} from '@transcoda/plugin-arr-common';
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

async function test(ctx: PluginContext): Promise<IntegrationTestOk | IntegrationTestFail> {
  const status = await testStatus(ctx, 'Radarr', 4);
  if (!status.ok) return status;
  let warning: string | null;
  try {
    const config = await arrClient(ctx, 'Radarr').get('/api/v3/config/mediamanagement');
    const found = unmonitorWarning(config, 'movies');
    if (found.fieldSeen === null) {
      const keys =
        typeof config === 'object' && config !== null && !Array.isArray(config)
          ? Object.keys(config).join(', ')
          : '';
      await ctx.log('debug', `unmonitor setting not found in mediamanagement; keys: ${keys}`);
    }
    warning = found.warning;
  } catch (e) {
    const why = e instanceof ArrHttpError ? String(e.status) : fetchErrorKind(e);
    if (why === null) throw e;
    warning = `could not read media management settings: ${why}`;
  }
  return warning === null ? status : { ...status, warnings: [warning] };
}

export const integration = defineIntegration({
  id: 'radarr',
  title: 'Radarr',
  settings: z.object({
    url: url().describe('Radarr URL, for example http://radarr:7878'),
    apiKey: secret().describe('API key (Settings → General)'),
    pathMappings: pathMappings().describe(
      'Paths as Radarr sees them → paths as Transcoda sees them; leave empty when both see the same folders',
    ),
    allowInsecureTls: allowInsecureTls().describe('Accept a self-signed certificate'),
  }),
  allowedOrigins: ['$settings.url'],
  requires: { product: 'radarr', minVersion: '4.0.0' },
  test,
});
