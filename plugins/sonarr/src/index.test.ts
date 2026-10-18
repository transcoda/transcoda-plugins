import { pluginManifest } from '@transcoda/sdk';
import { describe, expect, it } from 'vitest';
import plugin from './index.ts';

describe('sonarr plugin manifest', () => {
  it('lists its nodes, integration and node versions', () => {
    const m = pluginManifest(plugin);
    expect(m).toMatchObject({
      name: 'sonarr',
      version: '1.0.0',
      sdk: '^1',
      nodes: ['sonarr:original-language', 'sonarr:rescan'],
      integration: 'sonarr',
      triggers: [],
      hooks: [],
    });
    expect(m.nodeVersions).toEqual([
      { type: 'sonarr:original-language', version: 1, migrations: [] },
      { type: 'sonarr:rescan', version: 1, migrations: [] },
    ]);
  });
});
