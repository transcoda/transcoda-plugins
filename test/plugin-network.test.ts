// What each official plugin's manifest announces as `network` (the hosts the install dialog shows),
// derived by scripts/plugin-network.mjs the way the SDK's `pluginNetwork` does. Core refuses a
// bundle whose own list differs from its manifest, so the two derivations must agree: once the
// installed SDK exports `pluginNetwork` (1.3.0), the parity check below runs too.
import * as sdk from '@transcoda/sdk';
import { describe, expect, it } from 'vitest';
import bazarr from '../plugins/bazarr/src/index.ts';
import discord from '../plugins/discord/src/index.ts';
import jellyfin from '../plugins/jellyfin/src/index.ts';
import ntfy from '../plugins/ntfy/src/index.ts';
import radarr from '../plugins/radarr/src/index.ts';
import seerr from '../plugins/seerr/src/index.ts';
import sonarr from '../plugins/sonarr/src/index.ts';
import tmdb from '../plugins/tmdb/src/index.ts';
// @ts-expect-error: a plain .mjs script without types
import { pluginNetwork } from '../scripts/plugin-network.mjs';

const url = (label: string) => [{ setting: 'url', label }];

const EXPECTED = [
  [bazarr, url('Bazarr URL')],
  [discord, [{ origin: 'https://discord.com' }]],
  [jellyfin, url('Jellyfin URL')],
  [ntfy, url('ntfy server')],
  [radarr, url('Radarr URL')],
  [seerr, url('Seerr URL')],
  [sonarr, url('Sonarr URL')],
  [tmdb, [{ origin: 'https://api.themoviedb.org' }]],
] as const;

const sdkNetwork = (sdk as Record<string, unknown>).pluginNetwork as
  | ((integration: unknown) => unknown)
  | undefined;

describe('official plugins: network', () => {
  it.each(EXPECTED.map(([p, n]) => [p.name, p, n] as const))(
    '%s lists the hosts its integration may reach',
    (_name, plugin, network) => {
      expect(pluginNetwork(plugin.integration)).toEqual(network);
    },
  );

  it.skipIf(sdkNetwork === undefined)(
    'matches the SDK pluginNetwork for every plugin (SDK 1.3.0+)',
    () => {
      for (const [plugin] of EXPECTED) {
        expect(pluginNetwork(plugin.integration)).toEqual(sdkNetwork?.(plugin.integration));
      }
    },
  );

  it('a plugin without an integration reaches nothing', () => {
    expect(pluginNetwork(undefined)).toEqual([]);
  });
});
