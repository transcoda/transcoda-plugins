const pending = new Map<string, { promise: Promise<unknown>; startedAt: number }>();

/** Calls with the same key within `windowMs` of a pending call share its promise. */
export function coalesce<T>(
  key: string,
  windowMs: number,
  fn: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const at = now();
  const hit = pending.get(key);
  if (hit && at - hit.startedAt < windowMs) return hit.promise as Promise<T>;
  const entry = { promise: undefined as unknown as Promise<unknown>, startedAt: at };
  const release = () => {
    if (pending.get(key) === entry) pending.delete(key);
  };
  entry.promise = fn().finally(release);
  // The returned promise carries rejections to the caller; this keeps the cleanup chain quiet.
  entry.promise.catch(() => {});
  pending.set(key, entry);
  return entry.promise as Promise<T>;
}

export function coalesceReset(): void {
  pending.clear();
}
