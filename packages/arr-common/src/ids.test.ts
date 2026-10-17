import { describe, expect, it } from 'vitest';
import { idsOf } from './index.ts';

describe('idsOf', () => {
  it('keeps positive numbers and tt strings', () => {
    expect(idsOf({ tmdbId: 5, tvdbId: 6, imdbId: 'tt0000001' })).toEqual({
      tmdbId: 5,
      tvdbId: 6,
      imdbId: 'tt0000001',
    });
  });
  it('drops zero, negatives, empties and other shapes', () => {
    expect(idsOf({ tmdbId: 0, tvdbId: -1, imdbId: '' })).toEqual({});
    expect(idsOf({ tmdbId: '5', imdbId: 'nm123', tvdbId: null })).toEqual({});
    expect(idsOf(null)).toEqual({});
    expect(idsOf([1])).toEqual({});
  });
});
