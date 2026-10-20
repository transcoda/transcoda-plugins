import { definePlugin } from '@transcoda/sdk';
import pkg from '../package.json' with { type: 'json' };
import { integration } from './integration.ts';
import { originalLanguage } from './original-language.ts';

export { tmdbGet } from './client.ts';
export { integration, originalLanguage };

export default definePlugin({
  name: 'tmdb',
  version: pkg.version,
  sdk: pkg.transcoda.sdk,
  integration,
  nodes: [originalLanguage],
});
