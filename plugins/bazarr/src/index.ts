import { definePlugin } from '@transcoda/sdk';
import pkg from '../package.json' with { type: 'json' };
import { getSubtitlesNow } from './get-subtitles-now.ts';
import { hasSubtitles } from './has-subtitles.ts';
import { integration } from './integration.ts';
import { rescan } from './rescan.ts';
import { subtitlesPresent } from './subtitles-present.ts';

export { getSubtitlesNow, hasSubtitles, integration, rescan, subtitlesPresent };

export default definePlugin({
  name: 'bazarr',
  version: pkg.version,
  sdk: pkg.transcoda.sdk,
  integration,
  nodes: [hasSubtitles, subtitlesPresent, getSubtitlesNow, rescan],
});
