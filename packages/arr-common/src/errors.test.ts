import { FetchRefused, FetchTimeout } from '@transcoda/sdk';
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
