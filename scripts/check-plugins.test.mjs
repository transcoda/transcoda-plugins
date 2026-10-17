import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkPlugins } from './check-plugins.mjs';

function repoWith(name, pkg) {
  const root = mkdtempSync(join(tmpdir(), 'check-plugins-'));
  mkdirSync(join(root, 'plugins', name), { recursive: true });
  writeFileSync(join(root, 'plugins', name, 'package.json'), JSON.stringify(pkg));
  return root;
}

const valid = {
  name: '@transcoda/plugin-sonarr',
  version: '1.2.0',
  transcoda: { sdk: '^1' },
  scripts: { bundle: 'tsdown' },
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
  assert.equal(errors.length, 4);
  assert.match(errors.join('\n'), /name must be/);
  assert.match(errors.join('\n'), /transcoda\.sdk/);
  assert.match(errors.join('\n'), /runtime dependencies/);
  assert.match(errors.join('\n'), /postinstall/);
});
