import { describe, expect, it } from 'vitest';
import { buildMessage, renderTitle, truncateBytes } from './message.ts';

const base = {
  workflowName: 'Shrink',
  path: '/data/shows/Show/S01E01.mkv',
  outcome: 'replaced',
  beforeBytes: 1_200_000_000 as number | null,
  afterBytes: 900_000_000 as number | null,
  problems: [] as string[],
  reason: null as string | null,
};

describe('buildMessage', () => {
  it('names the file and the size change', () => {
    const lines = buildMessage(base).split('\n');
    expect(lines[0]).toBe('S01E01.mkv');
    expect(lines[1]).toBe('replaced · 1.2 GB → 0.9 GB (−25 %)');
  });

  it('formats megabytes and growth', () => {
    const text = buildMessage({ ...base, beforeBytes: 500_000_000, afterBytes: 550_000_000 });
    expect(text).toContain('500.0 MB → 550.0 MB (+10 %)');
  });

  it('leaves the sizes out when one is unknown', () => {
    const text = buildMessage({ ...base, afterBytes: null });
    expect(text.split('\n')[1]).toBe('replaced');
  });

  it('lists problems and the failure reason', () => {
    const text = buildMessage({
      ...base,
      outcome: 'failed',
      problems: ['rescan timed out', 'no match'],
      reason: 'ffmpeg exited 1',
    });
    expect(text).toContain('Problems:\nrescan timed out\nno match');
    expect(text).toContain('Reason: ffmpeg exited 1');
  });

  it('omits Problems and Reason when there are none', () => {
    const text = buildMessage(base);
    expect(text).not.toContain('Problems:');
    expect(text).not.toContain('Reason:');
  });
});

describe('truncateBytes', () => {
  it('keeps short text as is', () => {
    expect(truncateBytes('hello', 4000)).toBe('hello');
  });

  it('cuts multi-byte text on a character boundary and appends an ellipsis', () => {
    const out = truncateBytes('€'.repeat(5000 / 3 + 100), 4000);
    expect(out.endsWith('…')).toBe(true);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(4000);
    expect(out).not.toContain('�');
  });

  it('handles a 5000-byte string of 2-byte characters', () => {
    const out = truncateBytes('é'.repeat(2500), 4000);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(4000);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('�');
  });
});

describe('renderTitle', () => {
  it('replaces the known placeholders', () => {
    expect(
      renderTitle('{{workflow}}: {{file}} {{outcome}} {{workflow}}', {
        workflow: 'W',
        file: 'a.mkv',
        outcome: 'replaced',
      }),
    ).toBe('W: a.mkv replaced W');
  });

  it('leaves unknown placeholders as is', () => {
    expect(renderTitle('{{nope}} {{file}}', { workflow: 'W', file: 'f', outcome: 'o' })).toBe(
      '{{nope}} f',
    );
  });

  it('caps the title at 250 characters without splitting an emoji', () => {
    const out = renderTitle('{{file}}', { workflow: 'W', file: '😀'.repeat(400), outcome: 'o' });
    expect([...out]).toHaveLength(250);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('\uFFFD');
  });

  it('leaves a title of exactly 250 characters alone', () => {
    const title = 'a'.repeat(250);
    expect(renderTitle(title, { workflow: 'W', file: 'f', outcome: 'o' })).toBe(title);
  });
});
