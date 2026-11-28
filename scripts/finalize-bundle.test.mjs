import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
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
    `export default ${JSON.stringify({ nodes: [{ type: 'demo:a', version: 1 }], ...announce }).replace(/"(\w+)":/g, '$1:')};\n`,
  );
  return dir;
}
const run = (dir) => spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
const good = { name: 'demo', version: '1.0.0', sdk: '^1' };

it('writes the checksum and a manifest when the bundle agrees with package.json', () => {
  const dir = plugin(good);
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(readFileSync(join(dir, 'dist', 'demo-1.0.0.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.nodes, ['demo:a']);
  assert.deepEqual(manifest.nodeVersions, [{ type: 'demo:a', version: 1, migrations: [] }]);
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
});

it('nodeVersions carries each node version and its migrations (from, to, risk only)', () => {
  const dir = plugin({
    ...good,
    nodes: [
      {
        type: 'demo:a',
        version: 3,
        migrations: [
          { from: 1, to: 2, risk: 'safe', migrate: 'ignored' },
          { from: 2, to: 3, risk: 'review' },
        ],
      },
    ],
  });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(readFileSync(join(dir, 'dist', 'demo-1.0.0.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.nodeVersions, [
    {
      type: 'demo:a',
      version: 3,
      migrations: [
        { from: 1, to: 2, risk: 'safe' },
        { from: 2, to: 3, risk: 'review' },
      ],
    },
  ]);
});

it('network lists the integration origins: fixed ones, and url settings by their label', () => {
  const dir = plugin({
    ...good,
    integration: {
      id: 'demo',
      settings: {
        shape: {
          url: { description: 'Demo URL, for example http://demo:8080' },
          other: {},
        },
      },
      allowedOrigins: [
        'https://api.example.com',
        '$settings.url',
        '$settings.other',
        '$settings.url',
      ],
    },
  });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(readFileSync(join(dir, 'dist', 'demo-1.0.0.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.network, [
    { origin: 'https://api.example.com' },
    { setting: 'url', label: 'Demo URL' },
    { setting: 'other', label: 'other' },
  ]);
});

it('a plugin without an integration reaches nothing', () => {
  const dir = plugin(good);
  assert.equal(run(dir).status, 0);
  const manifest = JSON.parse(readFileSync(join(dir, 'dist', 'demo-1.0.0.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.network, []);
});

for (const [what, announce, pattern] of [
  ['name', { ...good, name: 'other' }, /manifest name 'other'/],
  ['version', { ...good, version: '1.0.1' }, /manifest version '1.0.1'/],
  ['sdk', { ...good, sdk: '^2' }, /manifest sdk '\^2'/],
]) {
  it(`exits 1 when the bundle's ${what} differs`, () => {
    const dir = plugin(announce);
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, pattern);
    assert.equal(existsSync(join(dir, 'dist', 'demo-1.0.0.manifest.json')), false);
  });
}

/** The demo plugin with `code` put before its default export. */
function withCode(code) {
  const dir = plugin(good);
  const file = join(dir, 'dist', 'demo-1.0.0.js');
  writeFileSync(file, `${code}\n${readFileSync(file, 'utf8')}`);
  return dir;
}

it('refuses a bundle that imports anything but a node: built-in', () => {
  for (const code of [
    'import "lodash";',
    "import x from 'lodash';",
    'const m = import("lodash");',
    'export { a } from "lodash";',
  ]) {
    const r = run(withCode(code));
    assert.equal(r.status, 1, code);
    assert.match(r.stderr, /imports 'lodash'; only node: built-ins/);
  }
  assert.equal(run(withCode('import { join } from "node:path";')).status, 0);
});

it('a string that only reads "import" or "from" is not an import', () => {
  const code =
    'const t = { id: "import", title: "Import from Demo", icon: "download", by: "from" };';
  const r = run(withCode(code));
  assert.equal(r.status, 0, r.stderr);
});
