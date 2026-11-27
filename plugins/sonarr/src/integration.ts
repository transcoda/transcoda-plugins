import { arrIntegrationTest } from '@transcoda/plugin-arr-common';
import { allowInsecureTls, defineIntegration, pathMappings, secret, url } from '@transcoda/sdk';
import { z } from 'zod';

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
  test: (ctx) => arrIntegrationTest(ctx, 'Sonarr'),
});
