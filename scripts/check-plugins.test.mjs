import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { checkPlugins } from './check-plugins.mjs';

function repoWith(name, pkg, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'check-plugins-'));
  mkdirSync(join(root, 'plugins', name), { recursive: true });
  writeFileSync(join(root, 'plugins', name, 'package.json'), JSON.stringify(pkg));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const rootPkg = JSON.stringify({ devDependencies: { '@transcoda/sdk': '1.3.0' } });

const valid = {
  name: '@transcoda/plugin-sonarr',
  version: '1.2.0',
  transcoda: { sdk: '^1', title: 'Sonarr' },
  scripts: { bundle: 'tsdown' },
  devDependencies: { '@transcoda/sdk': '1.3.0' },
};

test('accepts a valid plugin', () => {
  assert.deepEqual(checkPlugins(repoWith('sonarr', valid)), []);
});

test('rejects runtime dependencies, install scripts, a missing sdk range and a wrong name', () => {
  const errors = checkPlugins(
    repoWith('sonarr', {
      ...valid,
      name: 'sonarr',
      transcoda: {},
      dependencies: { zod: '4.6.7' },
      scripts: { ...valid.scripts, postinstall: 'node x.js' },
    }),
  );
  assert.equal(errors.length, 5);
  assert.match(errors.join('\n'), /name must be/);
  assert.match(errors.join('\n'), /transcoda\.sdk/);
  assert.match(errors.join('\n'), /transcoda\.title/);
  assert.match(errors.join('\n'), /runtime dependencies/);
  assert.match(errors.join('\n'), /postinstall/);
});

test('rejects an sdk range that is not valid semver', () => {
  const errors = checkPlugins(
    repoWith('sonarr', { ...valid, transcoda: { ...valid.transcoda, sdk: 'latest-ish' } }),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /transcoda\.sdk.*valid semver range/);
});

test('accepts a prerelease-friendly range', () => {
  assert.deepEqual(
    checkPlugins(
      repoWith('sonarr', { ...valid, transcoda: { ...valid.transcoda, sdk: '>=1.0.0-rc.1 <2' } }),
    ),
    [],
  );
});

test('rejects a missing or blank title', () => {
  const errors = checkPlugins(
    repoWith('sonarr', { ...valid, transcoda: { sdk: '^1', title: '  ' } }),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing transcoda\.title/);
});

const pinned = valid;

test('rejects an sdk pin that differs from the root, in a plugin or a package', () => {
  const errors = checkPlugins(
    repoWith(
      'sonarr',
      { ...pinned, devDependencies: { '@transcoda/sdk': '1.2.0' } },
      {
        'package.json': rootPkg,
        'packages/shared/package.json': JSON.stringify({
          name: '@transcoda/plugin-shared',
          devDependencies: { '@transcoda/sdk': '1.1.0' },
        }),
      },
    ),
  );
  assert.equal(errors.length, 2);
  assert.match(
    errors.join('\n'),
    /plugins\/sonarr: pins @transcoda\/sdk 1\.2\.0; the root pins 1\.3\.0/,
  );
  assert.match(errors.join('\n'), /packages\/shared: pins @transcoda\/sdk 1\.1\.0/);
});

test('rejects a plugin without the sdk devDependency', () => {
  const errors = checkPlugins(repoWith('sonarr', { ...valid, devDependencies: {} }));
  assert.deepEqual(errors, ['plugins/sonarr: missing the @transcoda/sdk devDependency']);
});

test('rejects a range the pinned sdk does not satisfy', () => {
  const errors = checkPlugins(
    repoWith(
      'sonarr',
      { ...pinned, transcoda: { ...valid.transcoda, sdk: '^2' } },
      {
        'package.json': rootPkg,
      },
    ),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /'\^2' is not satisfied by the pinned @transcoda\/sdk 1\.3\.0/);
});

test('rejects a range below the minor of a feature the code uses, also in a workspace package', () => {
  const uses = (feature) =>
    checkPlugins(
      repoWith(
        'sonarr',
        {
          ...pinned,
          devDependencies: { ...pinned.devDependencies, '@transcoda/plugin-shared': 'workspace:*' },
        },
        {
          'package.json': rootPkg,
          'plugins/sonarr/src/index.ts': 'export {};\n',
          'packages/shared/package.json': JSON.stringify({ name: '@transcoda/plugin-shared' }),
          'packages/shared/src/node.ts': feature,
        },
      ),
    );
  assert.match(uses('const n = { damagedOnly: true };')[0], /damagedOnly.*SDK 1\.1.*use '\^1\.1'/);
  assert.match(uses('import { pluginNetwork } from "@transcoda/sdk";')[0], /SDK 1\.3/);
  // A comment is not a use.
  assert.deepEqual(uses('// damagedOnly: true would need ^1.1\n'), []);
});

test('accepts a feature when the range starts at its minor', () => {
  const root = repoWith(
    'sonarr',
    { ...pinned, transcoda: { ...valid.transcoda, sdk: '^1.1' } },
    {
      'package.json': rootPkg,
      'plugins/sonarr/src/replace.ts': 'export const n = { damagedOnly: true };\n',
    },
  );
  assert.deepEqual(checkPlugins(root), []);
});

test('a plugin with a secret setting needs src/secret-hygiene.test.ts; one without does not', () => {
  const integration =
    "import { secret } from '@transcoda/sdk';\nexport const s = { apiKey: secret() };\n";
  const without = repoWith('sonarr', valid, { 'plugins/sonarr/src/integration.ts': integration });
  assert.deepEqual(checkPlugins(without), [
    'plugins/sonarr: has a secret setting but no src/secret-hygiene.test.ts',
  ]);
  const withTest = repoWith('sonarr', valid, {
    'plugins/sonarr/src/integration.ts': integration,
    'plugins/sonarr/src/secret-hygiene.test.ts': '',
  });
  assert.deepEqual(checkPlugins(withTest), []);
  const noSecret = repoWith('sonarr', valid, { 'plugins/sonarr/src/index.ts': 'export {};\n' });
  assert.deepEqual(checkPlugins(noSecret), []);
});

test('test helpers live in src/test-util.ts and nothing else imports test code', () => {
  const errorsFor = (files) => checkPlugins(repoWith('sonarr', valid, files));
  assert.deepEqual(
    errorsFor({
      'plugins/sonarr/src/test-util.ts':
        "import { fakePluginContext } from '@transcoda/sdk/testing';\n",
      'plugins/sonarr/src/find.test.ts': "import { BASE } from './test-util.ts';\n",
    }),
    [],
  );
  assert.deepEqual(errorsFor({ 'plugins/sonarr/src/test-support.ts': 'export {};\n' }), [
    'plugins/sonarr: src/test-support.ts looks like a test helper; name it src/test-util.ts',
  ]);
  assert.deepEqual(errorsFor({ 'plugins/sonarr/test/fixtures.ts': 'export {};\n' }), [
    'plugins/sonarr: test helpers go in src/test-util.ts, not a test/ directory',
  ]);
  for (const from of ['vitest', '@transcoda/plugin-test-utils', './test-util.ts']) {
    const errors = errorsFor({ 'plugins/sonarr/src/index.ts': `import { x } from '${from}';\n` });
    assert.equal(errors.length, 1, from);
    assert.match(errors[0], /src\/index\.ts imports test code/);
  }
});

test('the test-utils package may import vitest; other packages follow the helper rules', () => {
  const root = repoWith('sonarr', valid, {
    'packages/test-utils/package.json': JSON.stringify({ name: '@transcoda/plugin-test-utils' }),
    'packages/test-utils/src/index.ts': "import { expect } from 'vitest';\n",
    'packages/shared/package.json': JSON.stringify({ name: '@transcoda/plugin-shared' }),
    'packages/shared/test/fixtures.ts': 'export {};\n',
  });
  assert.deepEqual(checkPlugins(root), [
    'packages/shared: test helpers go in src/test-util.ts, not a test/ directory',
  ]);
});
