import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// The host and every bundle inline their own SDK copy, so `instanceof Fetch…` is always false in a real host.
// Classify with the SDK's `fetchErrorKind(e)` instead.
const root = fileURLToPath(new URL('..', import.meta.url));

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (path.endsWith('.ts')) yield path;
  }
}

test('no plugin or package source checks `instanceof Fetch…`', () => {
  const offenders = [];
  for (const group of ['plugins', 'packages']) {
    for (const pkg of readdirSync(join(root, group))) {
      const src = join(root, group, pkg, 'src');
      try {
        statSync(src);
      } catch {
        continue;
      }
      for (const file of sources(src)) {
        if (/instanceof\s+Fetch/.test(readFileSync(file, 'utf8')))
          offenders.push(file.slice(root.length));
      }
    }
  }
  assert.deepEqual(offenders, [], 'use fetchErrorKind(e) from @transcoda/sdk, not instanceof');
});
