import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkBundles } from './check-bundles.mjs';

function root(code) {
  const dir = mkdtempSync(join(tmpdir(), 'bundles-'));
  mkdirSync(join(dir, 'plugins', 'demo', 'dist'), { recursive: true });
  writeFileSync(join(dir, 'plugins', 'demo', 'dist', 'demo-1.0.0.js'), code);
  return dir;
}

test('a clean bundle passes', () => {
  assert.deepEqual(
    checkBundles(root("import { join } from 'node:path';\nexport default {};\n")),
    [],
  );
});

test('node:fs is one failure naming node:fs', () => {
  const errors = checkBundles(root("import { readFile } from 'node:fs';\nexport default {};\n"));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /node:fs/);
  assert.match(errors[0], /demo-1\.0\.0\.js/);
});

for (const [what, code] of [
  ['node:fs/promises', "import('node:fs/promises');"],
  ['node:child_process', "import 'node:child_process';"],
  ['node:worker_threads', "import 'node:worker_threads';"],
  ['node:vm', "import 'node:vm';"],
  ['node:inspector', "import 'node:inspector';"],
  ['process.binding', "process.binding('fs');"],
  ['new Function', "new Function('return 1');"],
  ['new Function with arguments', 'new Function("a", "return a");'],
  ['eval(', "eval ('1');"],
  ['globalThis.fetch', 'globalThis.fetch(url);'],
  ['bare fetch(', 'await fetch(url);'],
]) {
  test(`${what} fails`, () => {
    const errors = checkBundles(root(code));
    assert.equal(errors.length, 1, errors.join('\n'));
  });
}

test('the SDK own context.fetch text and method calls named fetch are allowed', () => {
  const code = [
    'const corePluginContext = () => ({ async fetch() {',
    "  throw new FetchRefused('core nodes have no integration');",
    '} });',
    'await ctx.plugin.fetch(url);',
    'const x = { fetch: async () => 1 };',
  ].join('\n');
  assert.deepEqual(checkBundles(root(code)), []);
});

test('zod own empty new Function probe is allowed', () => {
  assert.deepEqual(checkBundles(root('try { new Function(""); } catch (_) {}')), []);
});

test('a repo without plugins passes', () => {
  assert.deepEqual(checkBundles(mkdtempSync(join(tmpdir(), 'bundles-'))), []);
});
