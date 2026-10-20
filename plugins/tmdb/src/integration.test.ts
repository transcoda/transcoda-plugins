import { FetchTimeout } from '@transcoda/sdk';
import { fakePluginContext, runTest } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { readFixture } from './fixture.ts';
import { integration } from './integration.ts';

const KEY = '0123456789abcdef0123456789abcdef';
const auth = /\/3\/authentication/;

describe('tmdb integration test()', () => {
  it('accepts a key', async () => {
    const ctx = fakePluginContext({
      settings: { credential: KEY },
      responses: [{ match: { url: auth }, body: readFixture('tmdb/authentication.json') }],
    });
    expect(await runTest(integration, ctx)).toEqual({ ok: true, message: 'TMDB accepted the key' });
  });

  it('accepts a token', async () => {
    const ctx = fakePluginContext({
      settings: { credential: 'eyJ.read.token' },
      responses: [{ match: { url: auth }, body: readFixture('tmdb/authentication.json') }],
    });
    expect(await runTest(integration, ctx)).toEqual({
      ok: true,
      message: 'TMDB accepted the token',
    });
  });

  it('reports a 401 as unauthorized', async () => {
    const ctx = fakePluginContext({
      settings: { credential: KEY },
      responses: [{ match: { url: auth }, status: 401, body: { success: false } }],
    });
    expect(await runTest(integration, ctx)).toEqual({
      ok: false,
      kind: 'unauthorized',
      message: 'TMDB rejected the credential',
    });
  });

  it('reports a fetch failure as unreachable', async () => {
    const base = fakePluginContext({ settings: { credential: KEY } });
    const ctx = {
      ...base,
      async fetch(): Promise<never> {
        throw new FetchTimeout('timed out');
      },
    };
    const result = await runTest(integration, ctx);
    expect(result).toMatchObject({ ok: false, kind: 'unreachable' });
  });

  it('classifies by kind, not by class (the host has its own SDK copy)', async () => {
    class HostFetchError extends Error {
      readonly kind = 'refused';
    }
    const base = fakePluginContext({ settings: { credential: KEY } });
    const ctx = {
      ...base,
      async fetch(): Promise<never> {
        throw new HostFetchError('nope');
      },
    };
    expect(await runTest(integration, ctx)).toEqual({
      ok: false,
      kind: 'unreachable',
      message: 'Could not reach TMDB (refused)',
    });
  });

  it('declares one origin and a secret credential', () => {
    expect(integration.allowedOrigins).toEqual(['https://api.themoviedb.org']);
    expect(integration.settings.safeParse({ credential: KEY }).data).toEqual({
      credential: KEY,
      language: 'en-US',
    });
    expect(integration.settings.safeParse({ credential: KEY, language: 'english' }).success).toBe(
      false,
    );
  });
});
