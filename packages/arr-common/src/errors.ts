import { fetchErrorKind } from '@transcoda/sdk';
import { ArrHttpError, type ArrProduct } from './client.ts';

/** A short, secret-free reason for an expected failure; null for a programming error. */
export function describeFailure(
  product: ArrProduct,
  e: unknown,
): { message: string; retryable: boolean } | null {
  const kind = fetchErrorKind(e);
  if (kind !== null)
    return { message: `${product} unreachable: ${kind}`, retryable: kind !== 'refused' };
  if (e instanceof ArrHttpError) return { message: e.message, retryable: e.status >= 500 };
  return null;
}
