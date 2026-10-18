export type FetchKind = 'refused' | 'timeout' | 'rate-limited' | 'failed';
const KINDS: readonly string[] = ['refused', 'timeout', 'rate-limited', 'failed'];

/**
 * The fetch failure kind of an error, or null. Classifies by `kind`, never by class: the host
 * throws its own copy of the SDK's error classes and every bundle inlines another copy, so
 * `instanceof` never matches in a real host.
 */
export function fetchKindOf(e: unknown): FetchKind | null {
  if (!(e instanceof Error)) return null;
  const kind = (e as { kind?: unknown }).kind;
  return typeof kind === 'string' && KINDS.includes(kind) ? (kind as FetchKind) : null;
}
