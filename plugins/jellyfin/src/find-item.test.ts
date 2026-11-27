import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isWithin, parentDir } from './find-item.ts';

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

  it('reads a backslash in a / separated path as part of a name (found by a property test)', () => {
    expect(isWithin('/media/a\\b/x.mkv', '/media/a\\b')).toBe(true);
    expect(isWithin('/media/a\\b/x.mkv', '/media/a\\')).toBe(false);
    expect(parentDir('/media/Show/a\\b.mkv')).toBe('/media/Show');
  });
});

describe('parentDir', () => {
  it('drops the last path segment for / and \\ paths', () => {
    expect(parentDir('/movies/A (2020)/a.mkv')).toBe('/movies/A (2020)');
    expect(parentDir('D:\\Movies\\A\\a.mkv')).toBe('D:\\Movies\\A');
  });
});

describe('isWithin and parentDir (properties)', () => {
  // Segments may hold a backslash: a legal character in a file or folder name on Linux.
  const seg = (sep: string) =>
    fc
      .string({
        unit: fc.constantFrom('a', 'B', '.', ' ', '-', '(', 'é', sep === '/' ? '\\' : ':'),
        minLength: 1,
      })
      .filter((s) => s !== '.' && s !== '..');
  const posix = fc
    .array(seg('/'), { minLength: 1, maxLength: 4 })
    .map((s) => ({ sep: '/', parts: [''].concat(s) }));
  const windows = fc
    .tuple(
      fc.constantFrom('C:', 'D:', '\\\\server'),
      fc.array(seg('\\'), { minLength: 1, maxLength: 4 }),
    )
    .map(([root, s]) => ({ sep: '\\', parts: [root, ...s] }));
  const dir = fc.oneof(posix, windows);

  it('a path inside a folder is within it, with or without a trailing separator', () => {
    fc.assert(
      fc.property(
        dir,
        fc.array(fc.string({ minLength: 1, unit: fc.constantFrom('x', ' ', '.') }), {
          minLength: 1,
          maxLength: 3,
        }),
        ({ sep, parts }, rest) => {
          const folder = parts.join(sep);
          const file = [...parts, ...rest].join(sep);
          expect(isWithin(file, folder)).toBe(true);
          expect(isWithin(file, folder + sep)).toBe(true);
          expect(isWithin(folder, folder)).toBe(true);
          expect(parentDir(file)).toBe([...parts, ...rest.slice(0, -1)].join(sep));
        },
      ),
    );
  });

  it('a sibling that only shares a string prefix is not within the folder', () => {
    fc.assert(
      fc.property(
        dir,
        fc.string({ minLength: 1, unit: fc.constantFrom('x', ' ', '2') }),
        ({ sep, parts }, extra) => {
          const folder = parts.join(sep);
          expect(isWithin(`${folder}${extra}${sep}a.mkv`, folder)).toBe(false);
        },
      ),
    );
  });
});
