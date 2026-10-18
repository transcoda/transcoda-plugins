import { ArrHttpError } from '@transcoda/plugin-arr-common';

const FETCH_KINDS = ['refused', 'timeout', 'rate-limited', 'failed'] as const;
export type FetchKind = (typeof FETCH_KINDS)[number];

/**
 * The `kind` of a fetch failure, or null for anything else. Matched by property, not
 * `instanceof`: the host and this bundle each inline their own copy of the SDK, so the error
 * classes differ.
 */
export function fetchKindOf(e: unknown): FetchKind | null {
  if (typeof e !== 'object' || e === null) return null;
  const kind = (e as { kind?: unknown }).kind;
  return FETCH_KINDS.find((k) => k === kind) ?? null;
}

/** A short, secret-free description of an expected Radarr failure; null for a programming error. */
export function describeFailure(e: unknown): { message: string; retryable: boolean } | null {
  const kind = fetchKindOf(e);
  if (kind !== null)
    return { message: `Radarr unreachable: ${kind}`, retryable: kind !== 'refused' };
  if (e instanceof ArrHttpError) return { message: e.message, retryable: e.status >= 500 };
  return null;
}
