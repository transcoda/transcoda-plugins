// Shared by the tests only; index.ts never imports it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FakePluginContext, ScriptedResponse } from '@transcoda/sdk/testing';
import { fakeHookContext, fakePluginContext } from '@transcoda/sdk/testing';

export const BASE = 'http://192.0.2.20:5055';
export const SENTINEL = 'SENTINEL-SECRET-9f3a';
export const settings = { url: BASE, apiKey: 'key-1' };

export const get = (path: string, body: unknown, status = 200): ScriptedResponse => ({
  match: { url: BASE + path, method: 'GET' },
  status,
  body: body as never,
});

/** A recorded JSON fixture from test/fixtures/seerr. */
export function fixture(name: string): Record<string, unknown> {
  const url = new URL(`../../../test/fixtures/seerr/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

/** A hook context whose connected input ports carry `data`. */
export function dataCtx(plugin: FakePluginContext, data: Record<string, unknown> = {}) {
  return fakeHookContext({ plugin, data: data as never });
}

export const withSettings = (responses: ScriptedResponse[], over: Record<string, string> = {}) =>
  fakePluginContext({ settings: { ...settings, ...over }, responses });
