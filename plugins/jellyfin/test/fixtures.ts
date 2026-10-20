import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PluginFetchResponse } from '@transcoda/sdk';

type JsonValue = PluginFetchResponse['body'];

export function jellyfinFixture(name: 'system-info' | 'system-info-public'): JsonValue {
  const path = fileURLToPath(
    new URL(`../../../test/fixtures/jellyfin/${name}.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
}

export const BASE = 'http://jellyfin:8096';
export const KEY = 'SENTINEL-SECRET-9f3a';
export const settings: Record<string, JsonValue> = {
  url: BASE,
  apiKey: KEY,
  pathMappings: [],
  allowInsecureTls: false,
};
