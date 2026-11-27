import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildEmbed, formatSize, truncate } from './embed.ts';

const base = {
  workflowName: 'Shrink shows',
  path: '/data/shows/Example Show/S01E01.mkv',
  outcome: 'replaced',
  beforeBytes: 1_200_000_000,
  afterBytes: 900_000_000,
  problems: [] as string[],
  reason: null as string | null,
  jobUrl: null as string | null,
};

describe('buildEmbed', () => {
  it('uses the workflow name, the file basename and the three colours', () => {
    const clean = buildEmbed(base);
    expect(clean.title).toBe('Shrink shows');
    expect(clean.description).toBe('S01E01.mkv');
    expect(clean.color).toBe(0x2e7d32);
    expect(buildEmbed({ ...base, problems: ['subtitle dropped'] }).color).toBe(0xb26a00);
    expect(buildEmbed({ ...base, outcome: 'failed', reason: 'ffmpeg exited 1' }).color).toBe(
      0xc62828,
    );
  });

  it('links to the job only when a url is set', () => {
    expect(buildEmbed(base)).not.toHaveProperty('url');
    expect(buildEmbed({ ...base, jobUrl: 'https://t.example/jobs/7' }).url).toBe(
      'https://t.example/jobs/7',
    );
  });

  it('has a Result field and a Size field with the saving', () => {
    const e = buildEmbed(base);
    expect(e.fields).toContainEqual({ name: 'Result', value: 'replaced', inline: true });
    expect(e.fields).toContainEqual({
      name: 'Size',
      value: '1.2 GB → 0.9 GB (−25 %)',
      inline: true,
    });
  });

  it('omits the size when it is unknown and shows growth with a plus', () => {
    const e = buildEmbed({ ...base, outcome: 'failed', beforeBytes: null, afterBytes: null });
    expect(e.fields.some((f) => f.name === 'Size')).toBe(false);
    expect(formatSize(100, 110)).toBe('100 B → 110 B (+10 %)');
  });

  it('lists problems under Needs attention, else the reason', () => {
    const p = buildEmbed({ ...base, problems: ['a', 'b'], reason: 'ignored' });
    expect(p.fields).toContainEqual({ name: 'Needs attention', value: 'a\nb', inline: false });
    expect(p.fields.some((f) => f.name === 'Reason')).toBe(false);
    const r = buildEmbed({ ...base, outcome: 'failed', reason: 'ffmpeg exited 1' });
    expect(r.fields).toContainEqual({ name: 'Reason', value: 'ffmpeg exited 1', inline: false });
  });

  it('truncates to the Discord limits', () => {
    const e = buildEmbed({
      ...base,
      workflowName: 'w'.repeat(300),
      path: `/x/${'p'.repeat(5000)}`,
      problems: ['q'.repeat(2000)],
    });
    expect(e.title.length).toBe(256);
    expect(e.description.length).toBe(4096);
    const field = e.fields.find((f) => f.name === 'Needs attention');
    expect(field?.value.length).toBe(1024);
    expect(truncate('abc', 3)).toBe('abc');
    expect(truncate('abcd', 3)).toBe('ab…');
  });

  it('never splits a surrogate pair when truncating', () => {
    const out = truncate('😀😀😀😀', 3);
    expect(out).toBe('😀😀…');
    expect(Array.from(out)).toHaveLength(3);
    expect(truncate('😀😀😀', 3)).toBe('😀😀😀');
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('drops empty problems and sends no empty Needs attention field', () => {
    const e = buildEmbed({ ...base, problems: ['', '  '] });
    expect(e.fields.some((f) => f.name === 'Needs attention')).toBe(false);
    expect(e.color).toBe(0x2e7d32);
    const some = buildEmbed({ ...base, problems: ['', 'real'] });
    expect(some.fields).toContainEqual({ name: 'Needs attention', value: 'real', inline: false });
  });
});

// Discord rejects a whole message whose embed breaks a limit, so these hold for any input.
describe('embed limits (properties)', () => {
  const text = (max: number) => fc.string({ unit: 'binary', maxLength: max, size: 'max' });
  const bytes = fc.option(fc.nat({ max: 2 ** 52 }), { nil: null });
  const input = fc.record({
    workflowName: text(400),
    path: text(5000),
    outcome: fc.oneof(fc.constantFrom('replaced', 'kept', 'failed', 'skipped'), text(1500)),
    beforeBytes: bytes,
    afterBytes: bytes,
    problems: fc.array(text(300), { maxLength: 8 }),
    reason: fc.option(text(1500), { nil: null }),
    jobUrl: fc.option(fc.webUrl(), { nil: null }),
  });
  const points = (s: string) => Array.from(s).length;

  it('every part and the embed as a whole stay within Discord limits', () => {
    fc.assert(
      fc.property(input, (i) => {
        const e = buildEmbed(i);
        expect(points(e.title)).toBeLessThanOrEqual(256);
        expect(points(e.description)).toBeLessThanOrEqual(4096);
        expect(e.fields.length).toBeLessThanOrEqual(25);
        let total = points(e.title) + points(e.description);
        for (const f of e.fields) {
          expect(points(f.name)).toBeLessThanOrEqual(256);
          expect(points(f.value)).toBeLessThanOrEqual(1024);
          total += points(f.name) + points(f.value);
        }
        expect(total).toBeLessThanOrEqual(6000);
      }),
    );
  });

  it('truncate keeps a prefix, never splits a surrogate pair, and fits the limit', () => {
    fc.assert(
      fc.property(text(300), fc.integer({ min: 1, max: 300 }), (s, max) => {
        const out = truncate(s, max);
        expect(points(out)).toBeLessThanOrEqual(Math.max(max, 0));
        if (out === s) return;
        expect(out.endsWith('…')).toBe(true);
        expect(s.startsWith(out.slice(0, -1))).toBe(true);
        expect(/[\uD800-\uDBFF]$/.test(out.slice(0, -1))).toBe(false);
      }),
    );
  });

  it('formatSize shows both sizes in one unit and the sign of the change', () => {
    fc.assert(
      fc.property(fc.nat({ max: 2 ** 52 }), fc.nat({ max: 2 ** 52 }), (before, after) => {
        const out = formatSize(before, after);
        expect(out).not.toMatch(/NaN|Infinity/);
        const units = out.match(/[kMGT]?B/g) ?? [];
        expect(units).toHaveLength(2);
        expect(units[0]).toBe(units[1]);
        if (before === 0) expect(out).not.toContain('%');
        else if (after > before) expect(out).toMatch(/\((\+\d+|0) %\)$/);
        else if (after < before) expect(out).toMatch(/\((−\d+|0) %\)$/);
        else expect(out).toMatch(/\(0 %\)$/);
      }),
    );
  });
});

it('keeps the whole embed within 6000 characters by shortening the file name (found by a property test)', () => {
  const e = buildEmbed({
    ...base,
    workflowName: 'w'.repeat(300),
    path: `/${'f'.repeat(5000)}`,
    outcome: 'o'.repeat(2000),
    problems: ['p'.repeat(2000)],
  });
  const total = [e.title, e.description, ...e.fields.flatMap((f) => [f.name, f.value])].join(
    '',
  ).length;
  expect(total).toBeLessThanOrEqual(6000);
  expect(e.description.endsWith('…')).toBe(true);
});
