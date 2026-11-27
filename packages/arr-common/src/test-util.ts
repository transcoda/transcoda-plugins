// Test-only helpers for arr-common's tests and Sonarr's and Radarr's (`@transcoda/plugin-arr-common/test-util`).
// The package's index never exports it, so it never reaches a bundle.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { JsonValue } from './json.ts';

/** Reads a recorded JSON fixture from test/fixtures/arr. */
export function arrFixture(name: string): JsonValue {
  const url = new URL(`../../../test/fixtures/arr/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as JsonValue;
}
