import { describe, expect, it } from 'vitest';
import { isWithin } from './find-item.ts';

describe('isWithin', () => {
  it('matches the folder itself and paths inside it', () => {
    expect(isWithin('/movies', '/movies')).toBe(true);
    expect(isWithin('/movies/A (2020)/a.mkv', '/movies')).toBe(true);
    expect(isWithin('/movies/A (2020)/a.mkv', '/movies/')).toBe(true);
  });

  it('leaves a sibling that only shares a string prefix alone', () => {
    expect(isWithin('/moviesx/a.mkv', '/movies')).toBe(false);
    expect(isWithin('/shows/Example Showx/a.mkv', '/shows/Example Show')).toBe(false);
  });

  it('handles backslash paths from a Windows server', () => {
    expect(isWithin('D:\\Movies\\A\\a.mkv', 'D:\\Movies')).toBe(true);
    expect(isWithin('D:\\Moviesx\\a.mkv', 'D:\\Movies')).toBe(false);
  });
});
