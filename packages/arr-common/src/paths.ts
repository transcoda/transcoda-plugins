function trim(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, '') || '/' : p;
}

const hasDotDot = (p: string) => p.split('/').includes('..');

/**
 * Segment-aware: `/a/b` is under `/a`, `/a/b2` is not. Trailing slashes are ignored.
 * Callers pass normalised absolute paths: any path with a `..` segment, and an empty parent,
 * are never "under" anything.
 */
export function isUnder(parentDir: string, path: string): boolean {
  const parent = trim(parentDir);
  const child = trim(path);
  if (parent === '' || hasDotDot(parent) || hasDotDot(child)) return false;
  if (parent === '/') return child.startsWith('/');
  return child === parent || child.startsWith(`${parent}/`);
}

/** The item with the longest `path` that `remotePath` is under, or null. */
export function pickByPath<T extends { path: string }>(items: T[], remotePath: string): T | null {
  let best: T | null = null;
  for (const item of items) {
    if (!isUnder(item.path, remotePath)) continue;
    if (best === null || trim(item.path).length > trim(best.path).length) best = item;
  }
  return best;
}

/** Trailing-slash-trimmed, case-sensitive equality. */
export function sameFile(a: string, b: string): boolean {
  return trim(a) === trim(b);
}
