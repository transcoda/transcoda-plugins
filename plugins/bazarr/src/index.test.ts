import { nodeMetadata, parseSettings, pluginManifest } from '@transcoda/sdk';
import { describe, expect, it } from 'vitest';
import plugin, {
  getSubtitlesNow,
  hasSubtitles,
  integration,
  rescan,
  subtitlesPresent,
} from './index.ts';

describe('bazarr plugin', () => {
  it('has the manifest the plan fixes', () => {
    expect(pluginManifest(plugin)).toMatchObject({
      name: 'bazarr',
      version: '1.0.0',
      sdk: '^1',
      nodes: [
        'bazarr:has-subtitles',
        'bazarr:subtitles-present',
        'bazarr:get-subtitles-now',
        'bazarr:rescan',
      ],
      nodeVersions: [
        { type: 'bazarr:has-subtitles', version: 1 },
        { type: 'bazarr:subtitles-present', version: 1 },
        { type: 'bazarr:get-subtitles-now', version: 1 },
        { type: 'bazarr:rescan', version: 1 },
      ],
      integration: 'bazarr',
      triggers: [],
      hooks: [],
    });
  });

  it('declares its ports', () => {
    const data = nodeMetadata(hasSubtitles);
    expect(data.kind).toBe('data');
    expect(data.inputs).toEqual([]);
    expect(data.outputs.map((o) => [o.id, o.type])).toEqual([
      ['languages', 'data:languages'],
      ['forced', 'data:boolean'],
      ['sdh', 'data:boolean'],
    ]);
    const cond = nodeMetadata(subtitlesPresent);
    expect(cond.kind).toBe('condition');
    expect(cond.inputs.map((p) => [p.id, p.type])).toEqual([['file', 'file']]);
    expect(cond.outputs.map((p) => [p.id, p.type])).toEqual([
      ['pass', 'file'],
      ['else', 'file'],
    ]);
    const get = nodeMetadata(getSubtitlesNow);
    expect(get.kind).toBe('action');
    expect(get.hooks).toEqual(['build']);
    expect(get.inputs.map((p) => p.type)).toEqual(['file']);
    expect(get.outputs.map((p) => p.type)).toEqual(['file']);
    const re = nodeMetadata(rescan);
    expect(re.finishPhase).toBe('library-manager');
    expect(re.hooks).toEqual(['finish', 'run']);
    expect(re.outputs).toEqual([]);
  });

  it('validates the settings', () => {
    expect(parseSettings(rescan, {})).toEqual({ ok: true, value: { kind: 'auto' } });
    expect(parseSettings(hasSubtitles, {})).toEqual({
      ok: true,
      value: { kind: 'auto', include: 'all' },
    });
    expect(parseSettings(hasSubtitles, { kind: 'tv' }).ok).toBe(false);
    expect(parseSettings(subtitlesPresent, { languages: ['eng'] }).ok).toBe(true);
    expect(parseSettings(subtitlesPresent, {}).ok).toBe(false);
    expect(parseSettings(getSubtitlesNow, { languages: ['en'], waitSeconds: 4 }).ok).toBe(false);
  });

  it('exports the integration', () => {
    expect(integration.id).toBe('bazarr');
  });
});
