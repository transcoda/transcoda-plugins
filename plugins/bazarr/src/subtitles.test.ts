import type { JsonValue } from '@transcoda/plugin-arr-common';
import { describe, expect, it } from 'vitest';
import { subtitlesOf, summary } from './subtitles.ts';
import { ctxWith } from './test-util.ts';

const ctx = ctxWith([]);
const sub = (over: Record<string, JsonValue>) => ({
  code2: 'en',
  code3: 'eng',
  path: '/a/b.en.srt',
  forced: false,
  hi: false,
  ...over,
});

describe('subtitlesOf', () => {
  it('prefers code3 and normalises to ISO 639-2/T', () => {
    const subs = subtitlesOf(ctx, [sub({ code3: 'ger', code2: 'de' }), sub({ code3: 'fre' })]);
    expect(subs.map((s) => s.language)).toEqual(['deu', 'fra']);
  });

  it('falls back to code2 when code3 is missing, empty or null', () => {
    const subs = subtitlesOf(ctx, [
      sub({ code2: 'de', code3: null }),
      sub({ code2: 'fr', code3: '' }),
      { code2: 'es', path: 'x', forced: false, hi: false },
    ]);
    expect(subs.map((s) => s.language)).toEqual(['deu', 'fra', 'spa']);
  });

  it('reads forced and hi as booleans or True/False strings', () => {
    const subs = subtitlesOf(ctx, [
      sub({ forced: 'True', hi: 'False' }),
      sub({ forced: true, hi: true }),
      sub({ forced: 'true', hi: 'TRUE' }),
      sub({ forced: 'False', hi: false }),
      sub({ forced: null, hi: 1 }),
    ]);
    expect(subs.map((s) => [s.forced, s.sdh])).toEqual([
      [true, false],
      [true, true],
      [true, true],
      [false, false],
      [false, false],
    ]);
  });

  it('treats a null or empty path as embedded', () => {
    const subs = subtitlesOf(ctx, [sub({ path: null }), sub({ path: '' }), sub({})]);
    expect(subs.map((s) => s.external)).toEqual([false, false, true]);
  });

  it('keeps an unknown language as unknown and ignores junk', () => {
    const subs = subtitlesOf(ctx, [sub({ code3: 'und', code2: 'xx' }), 'nope', null, 7]);
    expect(subs).toEqual([{ language: 'unknown', external: true, forced: false, sdh: false }]);
    expect(subtitlesOf(ctx, null)).toEqual([]);
    expect(subtitlesOf(ctx, { not: 'an array' })).toEqual([]);
  });
});

describe('summary', () => {
  const subs = subtitlesOf(ctx, [
    sub({}),
    sub({ code3: 'deu', code2: 'de', path: null, forced: true }),
    sub({ code3: 'fra', code2: 'fr', hi: true }),
    sub({ code3: 'eng', code2: 'en', path: '/x.en.srt' }),
    sub({ code3: 'und', code2: 'xx' }),
  ]);

  it('lists sorted unique languages without unknown, with the flags', () => {
    expect(summary(subs, 'all')).toEqual({
      languages: ['deu', 'eng', 'fra'],
      forced: true,
      sdh: true,
    });
  });

  it('external counts only subtitle files', () => {
    expect(summary(subs, 'external')).toEqual({
      languages: ['eng', 'fra'],
      forced: false,
      sdh: true,
    });
  });

  it('embedded counts only tracks inside the video', () => {
    expect(summary(subs, 'embedded')).toEqual({ languages: ['deu'], forced: true, sdh: false });
  });
});
