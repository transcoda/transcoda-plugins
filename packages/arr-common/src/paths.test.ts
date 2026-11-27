import { createPaths } from '@transcoda/sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isUnder, pickByPath, sameFile } from './index.ts';

describe('isUnder', () => {
  it('is segment-aware', () => {
    expect(isUnder('/a', '/a/b')).toBe(true);
    expect(isUnder('/a', '/a/b2')).toBe(true);
    expect(isUnder('/a/b', '/a/b2')).toBe(false);
    expect(isUnder('/a/b', '/a/b/c.mkv')).toBe(true);
    expect(isUnder('/a/b', '/a/b')).toBe(true);
  });
  it('trims trailing slashes on both sides', () => {
    expect(isUnder('/a/b/', '/a/b/c')).toBe(true);
    expect(isUnder('/a/b', '/a/b/')).toBe(true);
    expect(isUnder('/a/b//', '/a/b2/')).toBe(false);
  });
  it('is false for an empty parent and for any .. segment', () => {
    expect(isUnder('', '/a')).toBe(false);
    expect(isUnder('///', '/a')).toBe(true);
    expect(isUnder('/a', '/a/../b')).toBe(false);
    expect(isUnder('/a/b/..', '/a/b/c')).toBe(false);
    expect(isUnder('/a', '/a/..hidden/x')).toBe(true);
  });
  it('treats / as the parent of every absolute path', () => {
    expect(isUnder('/', '/a')).toBe(true);
    expect(isUnder('/', 'relative')).toBe(false);
  });
});

describe('pickByPath', () => {
  const items = [
    { id: 1, path: '/data/shows/Show' },
    { id: 2, path: '/data/shows/Show 2' },
  ];
  it('matches only the sibling whose folder holds the file (not a string prefix)', () => {
    expect(pickByPath(items, '/data/shows/Show 2/S01E01.mkv')?.id).toBe(2);
    expect(pickByPath(items, '/data/shows/Show/S01E01.mkv')?.id).toBe(1);
  });
  it('does not match a path that climbs out with ..', () => {
    expect(pickByPath(items, '/data/shows/Show/../Show 2/x.mkv')).toBeNull();
  });
  it('returns null when nothing holds the path, and the longest match when nested', () => {
    expect(pickByPath(items, '/data/shows/Show 3/x.mkv')).toBeNull();
    expect(pickByPath(items, '/data/shows/Showcase/x.mkv')).toBeNull();
    const nested = [{ path: '/data' }, { path: '/data/shows/' }];
    expect(pickByPath(nested, '/data/shows/x/y.mkv')?.path).toBe('/data/shows/');
  });
});

describe('sameFile', () => {
  it('ignores trailing slashes but not case', () => {
    expect(sameFile('/a/b/', '/a/b')).toBe(true);
    expect(sameFile('/a/B', '/a/b')).toBe(false);
  });
});

// Property tests: random paths from segments with spaces, dots, backslashes and non-ASCII
// characters, and any number of trailing slashes (the seed and run count are in test/setup.ts).
const segment = fc
  .string({ unit: fc.constantFrom('a', 'B', '1', '.', ' ', '-', '\\', 'é', '😀'), minLength: 1 })
  .filter((s) => s !== '..');
const segments = (min = 1) => fc.array(segment, { minLength: min, maxLength: 5 });
const absolute = segments().map((s) => `/${s.join('/')}`);
const slashes = fc.nat(3).map((n) => '/'.repeat(n));

describe('path properties', () => {
  it('isUnder: a path below a folder is under it, whatever the trailing slashes', () => {
    fc.assert(
      fc.property(absolute, segments(0), slashes, slashes, (dir, rest, s1, s2) => {
        const child = [dir, ...rest].join('/');
        expect(isUnder(dir + s1, child + s2)).toBe(true);
      }),
    );
  });

  it('isUnder: a sibling that only shares a string prefix is not under the folder', () => {
    fc.assert(
      fc.property(absolute, segment, segments(0), (dir, extra, rest) => {
        const sibling = [dir + extra, ...rest].join('/');
        expect(isUnder(dir, sibling)).toBe(false);
      }),
    );
  });

  it('isUnder: a .. segment on either side never matches', () => {
    fc.assert(
      fc.property(segments(0), segments(0), absolute, (before, after, other) => {
        const climbing = `/${[...before, '..', ...after].join('/')}`;
        expect(isUnder(other, climbing)).toBe(false);
        expect(isUnder(climbing, other)).toBe(false);
        expect(isUnder('/', climbing)).toBe(false);
      }),
    );
  });

  it('isUnder both ways is the same file, and sameFile ignores only trailing slashes', () => {
    fc.assert(
      fc.property(absolute, absolute, slashes, (a, b, s) => {
        expect(sameFile(a, a + s)).toBe(true);
        expect(sameFile(a, b)).toBe(a === b);
        expect(sameFile(a, b)).toBe(sameFile(b, a));
        expect(isUnder(a, b) && isUnder(b, a + s)).toBe(sameFile(a, b));
        expect(sameFile(a, a.toUpperCase())).toBe(a === a.toUpperCase());
      }),
    );
  });

  it('pickByPath picks the deepest folder that holds the path, or null', () => {
    const target = segments(1).map((s) => `/${s.join('/')}`);
    fc.assert(
      fc.property(
        target,
        fc.array(fc.tuple(fc.nat(6), slashes)),
        fc.array(absolute, { maxLength: 4 }),
        (path, cuts, others) => {
          // Folders on the path's own chain (prefixes at segment boundaries), plus unrelated ones.
          const parts = path.split('/');
          const chain = cuts.map(
            ([n, s]) => parts.slice(0, Math.min(n, parts.length - 1) + 1).join('/') + s,
          );
          const items = [...chain, ...others].map((p, id) => ({ id, path: p }));
          const holders = items.filter((i) => isUnder(i.path, path));
          const picked = pickByPath(items, path);
          if (holders.length === 0) {
            expect(picked).toBeNull();
            return;
          }
          expect(picked).not.toBeNull();
          if (picked === null) return;
          expect(isUnder(picked.path, path)).toBe(true);
          const depth = (p: string) => p.replace(/\/+$/, '').length;
          for (const h of holders) expect(depth(h.path)).toBeLessThanOrEqual(depth(picked.path));
        },
      ),
    );
  });

  it('a mapped path lands under the remote folder, matches it, and maps back', () => {
    fc.assert(
      fc.property(
        absolute,
        absolute,
        segments(1),
        slashes,
        slashes,
        (local, remote, rest, s1, s2) => {
          const paths = createPaths([{ local: local + s1, remote: remote + s2 }]);
          const file = [local, ...rest].join('/');
          const mapped = paths.toRemote(file);
          expect(mapped).toBe([remote, ...rest].join('/'));
          expect(isUnder(remote + s2, mapped)).toBe(true);
          expect(pickByPath([{ path: '/elsewhere' }, { path: remote + s2 }], mapped)?.path).toBe(
            remote + s2,
          );
          expect(paths.toLocal(mapped)).toBe(file);
        },
      ),
    );
  });

  it('a root mapping on either side maps every path below it and back', () => {
    fc.assert(
      fc.property(absolute, segments(1), (folder, rest) => {
        const tail = `/${rest.join('/')}`;
        const toRoot = createPaths([{ local: folder, remote: '/' }]);
        expect(toRoot.toRemote(folder + tail)).toBe(tail);
        expect(toRoot.toLocal(tail)).toBe(folder + tail);
        const fromRoot = createPaths([{ local: '/', remote: folder }]);
        expect(fromRoot.toRemote(tail)).toBe(folder + tail);
        expect(fromRoot.toLocal(folder + tail)).toBe(tail);
      }),
    );
  });
});
