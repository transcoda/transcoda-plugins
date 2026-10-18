import { fakePluginContext } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { credentialKind, TmdbHttpError, tmdbGet } from './client.ts';

const KEY = '0123456789abcdef0123456789abcdef';

describe('credentialKind', () => {
  it('treats 32 hex characters as a key and anything else as a token', () => {
    expect(credentialKind(KEY)).toBe('key');
    expect(credentialKind('eyJhbGciOiJIUzI1NiJ9.payload.sig')).toBe('token');
    expect(credentialKind(KEY.toUpperCase())).toBe('token');
    expect(credentialKind(`${KEY}0`)).toBe('token');
  });
});

describe('tmdbGet', () => {
  it('sends a key as the api_key query via auth and adds the language', async () => {
    const ctx = fakePluginContext({
      settings: { credential: KEY, language: 'de-DE' },
      responses: [{ match: { url: /api\.themoviedb\.org\/3\/movie\/1\?/ }, body: { id: 1 } }],
    });
    await expect(tmdbGet(ctx, '/3/movie/1', { append: 'x' })).resolves.toEqual({ id: 1 });
    const [call] = ctx.calls;
    expect(call?.auth).toEqual({ query: { name: 'api_key', value: KEY } });
    const url = new URL(call?.url ?? '');
    expect(url.origin).toBe('https://api.themoviedb.org');
    expect(url.searchParams.get('language')).toBe('de-DE');
    expect(url.searchParams.get('append')).toBe('x');
    expect(url.search).not.toContain(KEY);
  });

  it('sends a read access token as a bearer', async () => {
    const ctx = fakePluginContext({
      settings: { credential: 'eyJ.token.value' },
      responses: [{ match: { url: /\/3\/tv\/2/ }, body: { id: 2 } }],
    });
    await tmdbGet(ctx, '/3/tv/2');
    expect(ctx.calls[0]?.auth).toEqual({ bearer: 'eyJ.token.value' });
    expect(new URL(ctx.calls[0]?.url ?? '').searchParams.get('language')).toBe('en-US');
  });

  it('maps 404 to null, 429 to a rate limit and other statuses to TmdbHttpError', async () => {
    const at = (status: number) =>
      fakePluginContext({
        settings: { credential: KEY },
        responses: [{ match: { url: /\/3\/x/ }, status }],
      });
    await expect(tmdbGet(at(404), '/3/x')).resolves.toBeNull();
    await expect(tmdbGet(at(429), '/3/x')).rejects.toMatchObject({ kind: 'rate-limited' });
    await expect(tmdbGet(at(500), '/3/x')).rejects.toBeInstanceOf(TmdbHttpError);
  });
});
