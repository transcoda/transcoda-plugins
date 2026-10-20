import { ArrHttpError } from '@transcoda/plugin-arr-common';
import { fetchErrorKind } from '@transcoda/sdk';

/** A short, secret-free description of an expected Radarr failure; null for a programming error. */
export function describeFailure(e: unknown): { message: string; retryable: boolean } | null {
  const kind = fetchErrorKind(e);
  if (kind !== null)
    return { message: `Radarr unreachable: ${kind}`, retryable: kind !== 'refused' };
  if (e instanceof ArrHttpError) return { message: e.message, retryable: e.status >= 500 };
  return null;
}
