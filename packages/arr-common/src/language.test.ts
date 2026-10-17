import { fakePluginContext } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { originalLanguageOf } from './index.ts';

const ctx = fakePluginContext();
const of = (name: string) => originalLanguageOf(ctx, { originalLanguage: { id: 1, name } });

describe('originalLanguageOf', () => {
  it('returns the canonical 639-2/T code', () => {
    expect(of('Japanese').language).toBe('jpn');
    expect(of('English').language).toBe('eng');
    expect(of('Japanese').reason).toBe('original language Japanese (ja)');
  });
  it('is unknown for Unknown, Original and unrecognised names', () => {
    for (const name of ['Unknown', 'Original', 'Klingon-ish']) {
      expect(of(name)).toEqual({
        language: 'unknown',
        reason: `original language "${name}" is not a known language`,
      });
    }
  });
  it('is unknown without an object', () => {
    expect(originalLanguageOf(ctx, null).language).toBe('unknown');
    expect(originalLanguageOf(ctx, {}).language).toBe('unknown');
    expect(originalLanguageOf(ctx, { originalLanguage: {} }).language).toBe('unknown');
  });
});
