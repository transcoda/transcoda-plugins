import { beforeEach, describe, expect, it } from 'vitest';
import { coalesce, coalesceReset } from './index.ts';

beforeEach(coalesceReset);

describe('coalesce', () => {
  it('shares a pending call made within the window', async () => {
    let runs = 0;
    let release: (v: number) => void = () => {};
    const fn = () => {
      runs++;
      return new Promise<number>((r) => {
        release = r;
      });
    };
    const a = coalesce('k', 5000, fn, () => 0);
    const b = coalesce('k', 5000, fn, () => 1000);
    release(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(runs).toBe(1);
  });

  it('starts a new call once the window has passed, and keys are independent', async () => {
    let runs = 0;
    const never = () => {
      runs++;
      return new Promise<number>(() => {});
    };
    coalesce('k', 5000, never, () => 0);
    coalesce('k', 5000, never, () => 4999);
    coalesce('k', 5000, never, () => 5000);
    coalesce('other', 5000, never, () => 5000);
    expect(runs).toBe(3);
  });

  it('forgets a settled call, including a rejected one', async () => {
    let runs = 0;
    await expect(
      coalesce('k', 5000, async () => {
        runs++;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await coalesce('k', 5000, async () => ++runs)).toBe(2);
  });

  it('lets an old call settling leave a newer entry alone', async () => {
    let releaseOld: (v: string) => void = () => {};
    coalesce(
      'k',
      1000,
      () =>
        new Promise<string>((r) => {
          releaseOld = r;
        }),
      () => 0,
    );
    let runs = 0;
    const newer = () => {
      runs++;
      return new Promise<string>(() => {});
    };
    coalesce('k', 1000, newer, () => 2000); // window passed: replaces the entry
    releaseOld('old');
    await Promise.resolve();
    await Promise.resolve();
    coalesce('k', 1000, newer, () => 2500); // must still join the newer pending call
    expect(runs).toBe(1);
  });

  it('delivers a rejection to every joiner', async () => {
    let fail: (e: Error) => void = () => {};
    const fn = () =>
      new Promise<number>((_, rej) => {
        fail = rej;
      });
    const a = coalesce('k', 5000, fn, () => 0);
    const b = coalesce('k', 5000, fn, () => 1);
    fail(new Error('boom'));
    await expect(a).rejects.toThrow('boom');
    await expect(b).rejects.toThrow('boom');
  });
});
