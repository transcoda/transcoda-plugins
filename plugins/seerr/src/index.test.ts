import { pluginManifest } from '@transcoda/sdk';
import { describe, expect, it } from 'vitest';
import plugin from './index.ts';

describe('seerr plugin manifest', () => {
  it('lists its nodes, integration and node versions', () => {
    const m = pluginManifest(plugin);
    expect(m).toMatchObject({
      name: 'seerr',
      version: '1.0.0',
      sdk: '^1',
      nodes: ['seerr:request', 'seerr:is-requested'],
      integration: 'seerr',
      triggers: [],
      hooks: [],
    });
    expect(m.nodeVersions).toEqual([
      { type: 'seerr:request', version: 1, migrations: [] },
      { type: 'seerr:is-requested', version: 1, migrations: [] },
    ]);
  });
});
