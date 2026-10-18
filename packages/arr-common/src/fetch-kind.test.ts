import { describe, expect, it } from 'vitest';
import { fetchKindOf } from './index.ts';

describe('fetchKindOf', () => {
  it('reads the kind of any error-like value, not the class', () => {
    for (const kind of ['refused', 'timeout', 'rate-limited', 'failed'] as const) {
      expect(fetchKindOf(Object.assign(new Error('x'), { kind }))).toBe(kind);
    }
  });
  it('is null for anything else', () => {
    expect(fetchKindOf(new Error('x'))).toBeNull();
    expect(fetchKindOf(Object.assign(new Error('x'), { kind: 'weird' }))).toBeNull();
    expect(fetchKindOf(null)).toBeNull();
    expect(fetchKindOf('failed')).toBeNull();
    expect(fetchKindOf({ kind: 'failed' })).toBeNull();
  });
});
