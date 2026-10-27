import { nodeMetadata, parseSettings, pluginManifest } from '@transcoda/sdk';
import { describe, expect, it } from 'vitest';
import plugin, { integration, originalLanguage, replaceDamaged, rescan } from './index.ts';

describe('radarr plugin', () => {
  it('has the manifest the plan fixes', () => {
    expect(pluginManifest(plugin)).toMatchObject({
      name: 'radarr',
      version: '1.1.0',
      sdk: '^1.1',
      nodes: ['radarr:original-language', 'radarr:rescan', 'radarr:replace-damaged'],
      nodeVersions: [
        { type: 'radarr:original-language', version: 1 },
        { type: 'radarr:rescan', version: 1 },
        { type: 'radarr:replace-damaged', version: 1 },
      ],
      integration: 'radarr',
      triggers: [],
      hooks: [],
    });
  });

  it('declares its ports', () => {
    const lang = nodeMetadata(originalLanguage);
    expect(lang.kind).toBe('data');
    expect(lang.inputs).toEqual([]);
    expect(lang.outputs.map((o) => [o.id, o.type])).toEqual([
      ['language', 'data:language'],
      ['title', 'data:text'],
      ['ids', 'data:ids'],
    ]);
    const meta = nodeMetadata(rescan);
    expect(meta.finishPhase).toBe('library-manager');
    expect(meta.hooks).toEqual(['finish', 'run']);
    expect(meta.outputs).toEqual([]);
    const replace = nodeMetadata(replaceDamaged);
    expect(replace.damagedOnly).toBe(true);
    expect(replace.finishPhase).toBe('library-manager');
    expect(replace.inputs.map((i) => i.id)).toEqual(['file']);
    expect(replace.outputs).toEqual([]);
  });

  it('validates the rescan timeout', () => {
    expect(parseSettings(rescan, {})).toEqual({ ok: true, value: { timeoutSeconds: 240 } });
    expect(parseSettings(rescan, { timeoutSeconds: 5 }).ok).toBe(false);
    expect(parseSettings(rescan, { timeoutSeconds: 601 }).ok).toBe(false);
  });

  it('exports the integration', () => {
    expect(integration.id).toBe('radarr');
  });
});
