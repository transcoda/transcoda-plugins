import {
  ArrHttpError,
  arrClient,
  fetchKindOf,
  testStatus,
  unmonitorWarning,
} from '@transcoda/plugin-arr-common';
import {
  allowInsecureTls,
  defineIntegration,
  type IntegrationTestFail,
  type IntegrationTestOk,
  type PluginContext,
  pathMappings,
  secret,
  url,
} from '@transcoda/sdk';
import { z } from 'zod';

async function test(ctx: PluginContext): Promise<IntegrationTestOk | IntegrationTestFail> {
  const result = await testStatus(ctx, 'Sonarr', 4);
  if (!result.ok) return result;
  try {
    const config = await arrClient(ctx, 'Sonarr').get('/api/v3/config/mediamanagement');
    const { warning, fieldSeen } = unmonitorWarning(config, 'episodes');
    if (fieldSeen === null) {
      const keys =
        typeof config === 'object' && config !== null && !Array.isArray(config)
          ? Object.keys(config).join(', ')
          : '(not an object)';
      await ctx.log('debug', `unmonitor setting not found in mediamanagement; keys: ${keys}`);
    }
    return warning === null ? result : { ...result, warnings: [warning] };
  } catch (e) {
    const kind = fetchKindOf(e);
    if (e instanceof ArrHttpError || kind !== null) {
      const why = e instanceof ArrHttpError ? String(e.status) : kind;
      return { ...result, warnings: [`could not read media management settings: ${why}`] };
    }
    throw e;
  }
}

export const integration = defineIntegration({
  id: 'sonarr',
  title: 'Sonarr',
  settings: z.object({
    url: url().describe('Sonarr URL, for example http://sonarr:8989'),
    apiKey: secret().describe('API key (Settings → General)'),
    pathMappings: pathMappings().describe(
      'Paths as Sonarr sees them → paths as Transcoda sees them; leave empty when both see the same folders',
    ),
    allowInsecureTls: allowInsecureTls().describe('Accept a self-signed certificate'),
  }),
  allowedOrigins: ['$settings.url'],
  requires: { product: 'sonarr', minVersion: '4.0.0' },
  test,
});
