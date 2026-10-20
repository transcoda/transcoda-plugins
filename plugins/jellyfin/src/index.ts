import { definePlugin } from '@transcoda/sdk';
import pkg from '../package.json' with { type: 'json' };
import { integration } from './integration.ts';
import { refresh } from './refresh.ts';

export { integration, refresh };

export default definePlugin({
  name: 'jellyfin',
  version: pkg.version,
  sdk: pkg.transcoda.sdk,
  integration,
  nodes: [refresh],
});
