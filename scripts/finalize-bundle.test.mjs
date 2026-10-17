import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./finalize-bundle.mjs', import.meta.url));

/** A plugin dir `demo` whose bundle announces `announce` while package.json says `pkg`. */
function plugin(announce, pkg = { version: '1.0.0', transcoda: { sdk: '^1' } }) {
  const dir = join(mkdtempSync(join(tmpdir(), 'finalize-')), 'demo');
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: '@transcoda/plugin-demo', ...pkg }),
  );
  writeFileSync(
    join(dir, 'dist', 'demo-1.0.0.js'),
    `export default ${JSON.stringify({ nodes: [{ type: 'demo:a' }], ...announce })};\n`,
  );
  return dir;
}
const run = (dir) => spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
const good = { name: 'demo', version: '1.0.0', sdk: '^1' };

test('writes the checksum and a manifest when the bundle agrees with package.json', () => {
  const dir = plugin(good);
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(readFileSync(join(dir, 'dist', 'demo-1.0.0.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.nodes, ['demo:a']);
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
});

for (const [what, announce, pattern] of [
  ['name', { ...good, name: 'other' }, /manifest name 'other'/],
  ['version', { ...good, version: '1.0.1' }, /manifest version '1.0.1'/],
  ['sdk', { ...good, sdk: '^2' }, /manifest sdk '\^2'/],
]) {
  test(`exits 1 when the bundle's ${what} differs`, () => {
    const dir = plugin(announce);
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, pattern);
    assert.equal(existsSync(join(dir, 'dist', 'demo-1.0.0.manifest.json')), false);
  });
}
