import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import fc from 'fast-check';
import { configureFastCheck } from '../test/fast-check.mjs';
import { checkBlocklist } from './check-blocklist.mjs';

const doc = (entries) => ({ schema: 1, generated: '2026-10-17T00:00:00.000Z', entries });
const entry = (over = {}) => ({
  id: 'bl-1',
  name: 'demo',
  versions: '>=1.0.0 <2.0.0',
  reason: 'Exfiltrates tokens',
  url: 'https://example.com/advisory/1',
  added: '2026-10-17T00:00:00.000Z',
  ...over,
});

it('the shipped blocklist passes', () => {
  execFileSync(process.execPath, ['scripts/check-blocklist.mjs'], { encoding: 'utf8' });
});

it('accepts sha-only and name+range entries', () => {
  assert.deepEqual(
    checkBlocklist(
      doc([
        entry(),
        entry({ id: 'bl-2', name: undefined, versions: undefined, sha256: 'f'.repeat(64) }),
      ]),
    ),
    [],
  );
});

it('an entry with neither sha256 nor name is one problem', () => {
  const problems = checkBlocklist(doc([entry({ name: undefined, versions: undefined })]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /entries\[0\].*sha256 or name/);
});

it('versions without name', () => {
  const problems = checkBlocklist(doc([entry({ name: undefined, sha256: 'a'.repeat(64) })]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /versions.*name/);
});

it('duplicate id', () => {
  const problems = checkBlocklist(doc([entry(), entry({ name: 'other' })]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /duplicate id 'bl-1'/);
});

it('bad range, bad hash, bad name, long reason', () => {
  const problems = checkBlocklist(
    doc([
      entry({ id: 'a', versions: 'not a range' }),
      entry({ id: 'b', sha256: 'XYZ' }),
      entry({ id: 'c', name: 'Bad_Name' }),
      entry({ id: 'd', reason: 'x'.repeat(201) }),
    ]),
  );
  assert.equal(problems.length, 4);
  assert.match(problems.join('\n'), /versions.*valid semver range/);
  assert.match(problems.join('\n'), /sha256.*64 lowercase hex/);
  assert.match(problems.join('\n'), /name/);
  assert.match(problems.join('\n'), /reason/);
});

it('unknown keys, empty range, added after generated, blank reason', () => {
  const problems = checkBlocklist({
    ...doc([
      entry({ id: 'a', extra: 1 }),
      entry({ id: 'b', versions: '' }),
      entry({ id: 'c', added: '2027-01-01T00:00:00.000Z' }),
      entry({ id: 'd', reason: '   ' }),
    ]),
    note: 'x',
  });
  assert.equal(problems.length, 5);
  assert.match(problems.join('\n'), /unknown key 'note'/);
  assert.match(problems.join('\n'), /unknown key 'extra'/);
  assert.match(problems.join('\n'), /entries\[1\].*versions/);
  assert.match(problems.join('\n'), /added is later than generated/);
  assert.match(problems.join('\n'), /entries\[3\].*reason/);
});

it('bad envelope', () => {
  assert.ok(checkBlocklist({ schema: 2, generated: 'yesterday', entries: 'no' }).length >= 2);
  assert.deepEqual(checkBlocklist(doc([])), []);
});

it('cli exits 1 with one line per problem', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-blocklist-'));
  try {
    const file = join(dir, 'blocklist.json');
    writeFileSync(file, JSON.stringify(doc([entry({ name: undefined, versions: undefined })])));
    const r = spawnSync(process.execPath, ['scripts/check-blocklist.mjs', file], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.equal(r.stderr.trim().split('\n').length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

configureFastCheck();

// Property tests: random entries, valid ones and ones with exactly one rule broken.
const hex64 = fc.stringMatching(/^[0-9a-f]{64}$/);
const name = fc.stringMatching(/^[a-z][a-z0-9-]{0,39}$/);
const iso = fc
  .date({
    min: new Date('2020-01-01T00:00:00Z'),
    max: new Date('2026-10-17T00:00:00Z'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString());
const reason = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((r) => r.trim() === r && r !== '');
const range = fc.constantFrom('*', '1.0.0', '>=1.0.0 <2.0.0', '^1.2.3', '~0.4.0', '<=3 || 5.x');
const validEntry = fc
  .record({
    sha256: fc.option(hex64, { nil: undefined }),
    name: fc.option(name, { nil: undefined }),
    versions: fc.option(range, { nil: undefined }),
    reason,
    url: fc.option(fc.webUrl({ validSchemes: ['https'] }), { nil: null }),
    added: iso,
  })
  .filter((e) => e.sha256 !== undefined || e.name !== undefined)
  .map((e) => (e.name === undefined ? { ...e, versions: undefined } : e));
const validDoc = fc
  .array(validEntry, { maxLength: 6 })
  .map((entries) => doc(entries.map((e, i) => ({ id: `bl-${i}`, ...e }))));
const json = (v) => JSON.parse(JSON.stringify(v));

it('property: any valid blocklist passes, also after a JSON round trip', () => {
  fc.assert(
    fc.property(validDoc, (d) => {
      assert.deepEqual(checkBlocklist(d), []);
      assert.deepEqual(checkBlocklist(json(d)), []);
    }),
  );
});

it('property: breaking one rule of one entry is reported against that entry', () => {
  const breakages = [
    (e) => ({ ...e, id: '' }),
    (e) => ({ ...e, sha256: 'F'.repeat(64) }),
    (e) => ({ ...e, name: 'Bad Name' }),
    (e) => ({ ...e, sha256: undefined, name: undefined, versions: undefined }),
    (e) => ({ ...e, reason: '   ' }),
    (e) => ({ ...e, reason: 'x'.repeat(201) }),
    (e) => ({ ...e, url: 'http://example.com/' }),
    (e) => ({ ...e, added: '2026-13-01T00:00:00Z' }),
    (e) => ({ ...e, added: '2027-01-01T00:00:00.000Z' }),
    (e) => ({ ...e, surprise: true }),
  ];
  fc.assert(
    fc.property(
      validDoc.filter((d) => d.entries.length > 0),
      fc.nat(),
      fc.constantFrom(...breakages),
      (d, pick, breakIt) => {
        const i = pick % d.entries.length;
        const entries = d.entries.map((e, j) => (j === i ? breakIt(e) : e));
        const problems = checkBlocklist(json({ ...d, entries }));
        assert.ok(problems.length > 0);
        for (const p of problems) assert.match(p, new RegExp(`^entries\\[${i}\\]`));
      },
    ),
  );
});

it('property: any JSON value gives a list of problems, never an exception', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.jsonValue(),
        fc
          .tuple(validDoc, fc.jsonValue())
          .map(([d, odd]) => ({ ...d, entries: [...d.entries, odd] })),
      ),
      (v) => {
        const problems = checkBlocklist(v);
        assert.ok(Array.isArray(problems));
        for (const p of problems) assert.equal(typeof p, 'string');
      },
    ),
  );
});
