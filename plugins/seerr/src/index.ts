import { definePlugin } from '@transcoda/sdk';
import pkg from '../package.json' with { type: 'json' };
import { integration } from './integration.ts';
import { isRequested } from './is-requested.ts';
import { request } from './request.ts';

export { integration, isRequested, request };

export default definePlugin({
  name: 'seerr',
  version: pkg.version,
  sdk: pkg.transcoda.sdk,
  integration,
  nodes: [request, isRequested],
});
