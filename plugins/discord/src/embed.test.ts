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
