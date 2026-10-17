import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hostCheck } from './host-check.mjs';

const stamp = { name: 'demo', version: '1.0.0', sdk: '^1' };

function repo(manifest = stamp) {
  const root = mkdtempSync(join(tmpdir(), 'host-check-'));
  const dist = join(root, 'plugins', 'demo', 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'demo-1.0.0.js'), '');
  if (manifest) writeFileSync(join(dist, 'demo-1.0.0.manifest.json'), JSON.stringify(manifest));
  return root;
}
const ok = { ok: true, compatible: true, ...stamp };
const run = (root, result) =>
  hostCheck(
    root,
    '/fake/main.js',
    () => result,
    () => {},
  );

test('passes when core accepts the bundle and agrees with the stamped manifest', () => {
  assert.deepEqual(run(repo(), ok), []);
});

test('fails when core says ok:false', () => {
  const failures = run(repo(), { ok: false, error: 'bundle has no plugin default export' });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /no plugin default export/);
});

test('fails when the sdk range is not compatible', () => {
  assert.match(run(repo(), { ...ok, compatible: false })[0], /not satisfied/);
});

test('fails when core reports a different name, version or sdk than the stamp', () => {
  assert.match(run(repo(), { ...ok, version: '1.0.1' })[0], /version '1.0.1'.*'1.0.0'/);
});

test('fails when the stamped manifest is missing or no bundle exists', () => {
  assert.match(run(repo(null), ok)[0], /manifest\.json is missing/);
  const empty = mkdtempSync(join(tmpdir(), 'host-check-'));
  mkdirSync(join(empty, 'plugins'));
  assert.match(run(empty, ok)[0], /no bundles/);
});
