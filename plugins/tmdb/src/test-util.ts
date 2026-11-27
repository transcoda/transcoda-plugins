// Test helper only (never imported by index.ts, so never bundled).
import { readFileSync } from 'node:fs';
import type { PluginFetchResponse } from '@transcoda/sdk';

export function readFixture(name: string): PluginFetchResponse['body'] {
  const url = new URL(`../../../test/fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as PluginFetchResponse['body'];
}
