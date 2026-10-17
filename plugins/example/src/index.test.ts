import { nodeMetadata, parseSettings } from '@transcoda/sdk';
import { describe, expect, it } from 'vitest';
import plugin, { extensionIs, extensionMatches, nodes } from './index.ts';

describe('extensionMatches', () => {
  it('matches case-insensitively on the last extension', () => {
    expect(extensionMatches('/media/Show.S01E01.MKV', ['mkv'])).toBe(true);
    expect(extensionMatches('/media/movie.mp4', ['mkv', 'avi'])).toBe(false);
  });

  it('ignores dots in directory names', () => {
    expect(extensionMatches('/media/v1.0/README', ['0/readme', '0'])).toBe(false);
  });
});

describe('extension-is node', () => {
  it('produces serialisable metadata', () => {
    const meta = nodeMetadata(extensionIs);
    expect(meta.type).toBe('example:extension-is');
    expect(meta.kind).toBe('condition');
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta);
  });

  it('defaults and validates settings', () => {
    expect(parseSettings(extensionIs, {})).toEqual({ ok: true, value: { extensions: ['mkv'] } });
    expect(parseSettings(extensionIs, { extensions: ['.MKV'] }).ok).toBe(false);
  });

  it('decides pass or else from the context path', async () => {
    await expect(extensionIs.decide?.({ path: '/a/b.mkv' }, { extensions: ['mkv'] })).resolves.toBe(
      'pass',
    );
    await expect(extensionIs.decide?.({}, { extensions: ['mkv'] })).resolves.toBe('else');
  });
});

describe('plugin', () => {
  it('takes name and version from package.json and exports its nodes', () => {
    expect(plugin.name).toBe('@transcoda/plugin-example');
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(nodes).toContain(extensionIs);
  });
});
