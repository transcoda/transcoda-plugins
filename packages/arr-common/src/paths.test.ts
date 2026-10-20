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
