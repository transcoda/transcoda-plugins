import { importTrigger } from '@transcoda/plugin-arr-common';
import { definePlugin } from '@transcoda/sdk';
import pkg from '../package.json' with { type: 'json' };
import { integration } from './integration.ts';
import { originalLanguage } from './original-language.ts';
import { replaceDamaged } from './replace-damaged.ts';
import { rescan } from './rescan.ts';

const trigger = importTrigger('radarr');

export { integration, originalLanguage, replaceDamaged, rescan, trigger };

export default definePlugin({
  name: 'radarr',
  version: pkg.version,
  sdk: pkg.transcoda.sdk,
  integration,
  nodes: [originalLanguage, rescan, replaceDamaged],
  triggers: [trigger],
});
