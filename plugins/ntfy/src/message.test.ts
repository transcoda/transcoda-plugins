import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  basename,
  buildMessage,
  MAX_MESSAGE_BYTES,
  MAX_TITLE_CHARS,
  renderTitle,
  truncateBytes,
} from './message.ts';

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

describe('message limits (properties)', () => {
  const text = (max: number) => fc.string({ unit: 'binary', maxLength: max, size: 'max' });
  const bytes = fc.option(fc.nat({ max: 2 ** 52 }), { nil: null });
  const utf8 = (s: string) => Buffer.byteLength(s);

  it('a message never passes the byte limit, and starts with the file name', () => {
    fc.assert(
      fc.property(
        fc.record({
          workflowName: text(200),
          path: text(600),
          outcome: text(100),
          beforeBytes: bytes,
          afterBytes: bytes,
          problems: fc.array(text(800), { maxLength: 10 }),
          reason: fc.option(text(2000), { nil: null }),
        }),
        (input) => {
          const out = buildMessage(input);
          expect(utf8(out)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
          const name = basename(input.path);
          if (utf8(name) < MAX_MESSAGE_BYTES - 3) expect(out.startsWith(name)).toBe(true);
        },
      ),
    );
  });

  it('truncateBytes cuts between characters and keeps a prefix', () => {
    fc.assert(
      fc.property(text(400), fc.integer({ min: 3, max: 1200 }), (s, max) => {
        const out = truncateBytes(s, max);
        expect(utf8(out)).toBeLessThanOrEqual(max);
        if (out === s) return;
        const kept = out.slice(0, -1);
        expect(out.endsWith('…')).toBe(true);
        expect(s.startsWith(kept)).toBe(true);
        expect(/[\uD800-\uDBFF]$/.test(kept)).toBe(false);
      }),
    );
  });

  it('a title fills the template once and stays within the character limit', () => {
    const vars = fc.record({ workflow: text(200), file: text(300), outcome: text(50) });
    fc.assert(
      fc.property(text(100), vars, (prefix, v) => {
        const out = renderTitle(`${prefix}{{file}}`, v);
        expect([...out].length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
        // A value that itself looks like a placeholder is inserted as text, not expanded again.
        const literal = renderTitle('{{workflow}}', { ...v, workflow: '{{file}}' });
        expect(literal).toBe('{{file}}');
      }),
    );
  });

  it('basename is the last segment, whatever the trailing slashes', () => {
    const seg = fc.string({ unit: fc.constantFrom('a', '.', ' ', '\\', 'é'), minLength: 1 });
    fc.assert(
      fc.property(fc.array(seg, { maxLength: 4 }), seg, fc.nat(3), (dirs, name, n) => {
        expect(basename(`/${[...dirs, name].join('/')}${'/'.repeat(n)}`)).toBe(name);
      }),
    );
  });
});
