import {
  FetchFailed,
  FetchRateLimited,
  FetchRefused,
  FetchTimeout,
  fetchErrorKind,
} from '@transcoda/sdk';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ArrHttpError, describeFailure } from './index.ts';

describe('describeFailure', () => {
  it('names the product for a fetch failure; only a refused connection is not retried', () => {
    expect(describeFailure('Radarr', new FetchTimeout('slow'))).toEqual({
      message: 'Radarr unreachable: timeout',
      retryable: true,
    });
    expect(describeFailure('Sonarr', new FetchRefused('no'))).toEqual({
      message: 'Sonarr unreachable: refused',
      retryable: false,
    });
  });

  it('retries a 5xx answer, not a 4xx one', () => {
    expect(describeFailure('Sonarr', new ArrHttpError('Sonarr', 503, '/api/v3/series'))).toEqual({
      message: 'Sonarr answered 503 for /api/v3/series',
      retryable: true,
    });
    expect(describeFailure('Sonarr', new ArrHttpError('Sonarr', 404, '/api/v3/series'))).toEqual({
      message: 'Sonarr answered 404 for /api/v3/series',
      retryable: false,
    });
  });

  it('returns null for a programming error, so the caller rethrows it', () => {
    expect(describeFailure('Radarr', new TypeError('x is undefined'))).toBeNull();
  });
});

describe('describeFailure properties', () => {
  const product = fc.constantFrom('Sonarr' as const, 'Radarr' as const);

  it('an HTTP error keeps its message and is retried exactly when the status is 5xx', () => {
    fc.assert(
      fc.property(product, fc.integer({ min: 100, max: 599 }), fc.string(), (p, status, path) => {
        const e = new ArrHttpError(p, status, path);
        expect(describeFailure(p, e)).toEqual({ message: e.message, retryable: status >= 500 });
      }),
    );
  });

  it('a fetch failure names the product and its kind, never its message', () => {
    const errors = [FetchRefused, FetchTimeout, FetchRateLimited, FetchFailed];
    fc.assert(
      fc.property(product, fc.constantFrom(...errors), fc.string(), (p, Err, message) => {
        const e = new Err(message);
        const kind = fetchErrorKind(e);
        expect(describeFailure(p, e)).toEqual({
          message: `${p} unreachable: ${kind}`,
          retryable: kind !== 'refused',
        });
      }),
    );
  });

  it('never throws, and returns null for anything that is neither', () => {
    fc.assert(
      fc.property(product, fc.anything(), (p, value) => {
        const result = describeFailure(p, value);
        if (fetchErrorKind(value) === null && !(value instanceof ArrHttpError)) {
          expect(result).toBeNull();
        }
      }),
    );
  });
});
