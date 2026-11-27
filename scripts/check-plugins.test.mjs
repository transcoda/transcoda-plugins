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
