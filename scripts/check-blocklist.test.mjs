import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
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

test('the shipped blocklist passes', () => {
  execFileSync(process.execPath, ['scripts/check-blocklist.mjs'], { encoding: 'utf8' });
});

test('accepts sha-only and name+range entries', () => {
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

test('an entry with neither sha256 nor name is one problem', () => {
  const problems = checkBlocklist(doc([entry({ name: undefined, versions: undefined })]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /entries\[0\].*sha256 or name/);
});

test('versions without name', () => {
  const problems = checkBlocklist(doc([entry({ name: undefined, sha256: 'a'.repeat(64) })]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /versions.*name/);
});

test('duplicate id', () => {
  const problems = checkBlocklist(doc([entry(), entry({ name: 'other' })]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /duplicate id 'bl-1'/);
});

test('bad range, bad hash, bad name, long reason', () => {
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

test('unknown keys, empty range, added after generated, blank reason', () => {
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

test('bad envelope', () => {
  assert.ok(checkBlocklist({ schema: 2, generated: 'yesterday', entries: 'no' }).length >= 2);
  assert.deepEqual(checkBlocklist(doc([])), []);
});

test('cli exits 1 with one line per problem', () => {
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
