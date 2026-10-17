import { nodeMetadata, parseSettings, pluginManifest } from '@transcoda/sdk';
import { fakeHookContext, runDecide } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import plugin, { extensionIs, extensionMatches } from './index.ts';

const file = (path: string) => ({
  ...fakeHookContext({ file: { path, sizeBytes: 1, mtime: '2026-10-17T00:00:00.000Z', nlink: 1 } }),
  now: 0,
});

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
  it('produces serialisable metadata that declares the decide hook', () => {
    const meta = nodeMetadata(extensionIs);
    expect(meta.type).toBe('example:extension-is');
    expect(meta.kind).toBe('condition');
    expect(meta.hooks).toEqual(['decide']);
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta);
  });

  it('defaults and validates settings', () => {
    expect(parseSettings(extensionIs, {})).toEqual({ ok: true, value: { extensions: ['mkv'] } });
    expect(parseSettings(extensionIs, { extensions: ['.MKV'] }).ok).toBe(false);
  });

  it('passes a matching extension with the reason text', async () => {
    await expect(runDecide(extensionIs, file('/a/b.MKV'), {})).resolves.toEqual({
      port: 'pass',
      reason: 'extension mkv is one of mkv',
      findings: { extension: 'mkv' },
    });
  });

  it('takes the else port otherwise', async () => {
    await expect(
      runDecide(extensionIs, file('/a/b.mp4'), { extensions: ['mkv', 'avi'] }),
    ).resolves.toEqual({
      port: 'else',
      reason: 'extension mp4 is not one of mkv, avi',
      findings: { extension: 'mp4' },
    });
    const none = await runDecide(extensionIs, file('/a/README'), {});
    expect(none.port).toBe('else');
    expect(none.reason).toBe('extension (none) is not one of mkv');
  });
});

describe('plugin', () => {
  it('announces the bare name, the version and the sdk range', () => {
    expect(pluginManifest(plugin)).toEqual({
      name: 'example',
      version: '1.0.0',
      sdk: '^1',
      nodes: ['example:extension-is'],
      integration: null,
      triggers: [],
      hooks: [],
    });
  });
});
