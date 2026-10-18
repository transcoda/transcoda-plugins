import {
  fakePluginContext,
  runData,
  runDecide,
  runTest,
  type ScriptedResponse,
} from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { integration } from './integration.ts';
import { isRequested } from './is-requested.ts';
import { request } from './request.ts';
import { BASE, dataCtx, fixture, get, SENTINEL } from './test-util.ts';

const settings = { url: BASE, apiKey: SENTINEL };

function assertClean(ctx: ReturnType<typeof fakePluginContext>, texts: string[]) {
  for (const [, line] of ctx.logs) expect(line).not.toContain(SENTINEL);
  for (const t of texts) expect(t).not.toContain(SENTINEL);
  expect(ctx.calls.length).toBeGreaterThan(0);
  for (const c of ctx.calls) {
    expect(c.url).not.toContain(SENTINEL);
    expect(JSON.stringify(c.headers ?? {})).not.toContain(SENTINEL);
    expect(JSON.stringify(c.body ?? null)).not.toContain(SENTINEL);
    expect(c.auth).toEqual({ header: { name: 'X-Api-Key', value: SENTINEL } });
  }
}

const lookups: ScriptedResponse[][] = [
  [get('/api/v1/movie/900001', fixture('movie-requested'))],
  [get('/api/v1/movie/900001', null, 401)],
  [get('/api/v1/movie/900001', null, 500)],
  [get('/api/v1/movie/900001', null, 404)],
  [],
];

describe('secret hygiene', () => {
  it('test() carries the key only in auth', async () => {
    for (const responses of [
      [get('/api/v1/status', fixture('status')), get('/api/v1/auth/me', fixture('auth-me'))],
      [get('/api/v1/status', fixture('status')), get('/api/v1/auth/me', null, 401)],
      [get('/api/v1/status', { nope: true })],
      [],
    ]) {
      const ctx = fakePluginContext({ settings, responses });
      const r = await runTest(integration, ctx);
      assertClean(ctx, [JSON.stringify(r)]);
    }
  });

  it('seerr:request never leaks the key', async () => {
    for (const responses of lookups) {
      const ctx = fakePluginContext({ settings, responses });
      const r = await runData(request, dataCtx(ctx, { ids: { tmdbId: 900001 } }), {});
      assertClean(ctx, [JSON.stringify(r)]);
    }
  });

  it('seerr:is-requested never leaks the key', async () => {
    for (const responses of lookups) {
      const ctx = fakePluginContext({ settings, responses });
      const r = await runDecide(isRequested, dataCtx(ctx, { ids: { tmdbId: 900001 } }), {});
      assertClean(ctx, [JSON.stringify(r)]);
    }
  });

  it('a title search never leaks the key', async () => {
    const ctx = fakePluginContext({
      settings,
      responses: [get('/api/v1/search?query=Example%20Movie&page=1', null, 500)],
    });
    const r = await runData(request, dataCtx(ctx, { title: 'Example Movie' }), {});
    assertClean(ctx, [JSON.stringify(r)]);
  });

  it('a thrown fetch error carrying nothing secret keeps the sentinel out of the reason', async () => {
    const ctx = fakePluginContext({ settings });
    ctx.fetch = async (input) => {
      ctx.calls.push(input);
      throw Object.assign(new Error('connection refused'), { kind: 'refused' });
    };
    const r = await runData(request, dataCtx(ctx, { ids: { tmdbId: 1 } }), {});
    assertClean(ctx, [JSON.stringify(r)]);
  });
});
