import { runTest } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { integration } from './integration.ts';
import { BASE, ctxWith, fetchFailure, fixture } from './test-util.ts';

const STATUS = `${BASE}/api/system/status`;
const status = (v?: string) => ({ data: v === undefined ? {} : { bazarr_version: v } });

describe('bazarr integration', () => {
  it('declares the integration', () => {
    expect(integration.id).toBe('bazarr');
    expect(integration.title).toBe('Bazarr');
    expect(integration.allowedOrigins).toEqual(['$settings.url']);
    expect(integration.requires).toEqual({ product: 'bazarr', minVersion: '1.4.0' });
    expect(Object.keys(integration.settings.shape)).toEqual([
      'url',
      'apiKey',
      'pathMappings',
      'timeoutSeconds',
      'allowInsecureTls',
    ]);
  });

  it('is ok on a current Bazarr and strips a leading v', async () => {
    for (const v of ['v1.5.1', '1.5.1']) {
      const ctx = ctxWith([{ match: { url: STATUS }, body: status(v) }]);
      expect(await runTest(integration, ctx)).toEqual({
        ok: true,
        message: `Bazarr 1.5.1 at ${BASE}`,
        version: '1.5.1',
      });
    }
  });

  it('accepts the recorded status fixture', async () => {
    const ctx = ctxWith([{ match: { url: STATUS }, body: fixture('system-status') }]);
    expect(await runTest(integration, ctx)).toEqual({
      ok: true,
      message: `Bazarr 1.5.1 at ${BASE}`,
      version: '1.5.1',
    });
    expect(ctx.calls[0]?.timeoutMs).toBe(10_000);
  });

  it('reads data.version when bazarr_version is absent', async () => {
    const ctx = ctxWith([{ match: { url: STATUS }, body: { data: { version: 'v1.4.0' } } }]);
    expect(await runTest(integration, ctx)).toMatchObject({ ok: true, version: '1.4.0' });
  });

  it('reports a rejected key for 401 and 403', async () => {
    for (const code of [401, 403]) {
      const ctx = ctxWith([{ match: { url: STATUS }, status: code }]);
      expect(await runTest(integration, ctx)).toEqual({
        ok: false,
        kind: 'unauthorized',
        message: 'Bazarr rejected the API key',
      });
    }
  });

  it('reports an unreachable Bazarr with the failure kind', async () => {
    const ctx = ctxWith([]);
    expect(await runTest(integration, ctx)).toEqual({
      ok: false,
      kind: 'unreachable',
      message: `Bazarr is not reachable at ${BASE}: failed`,
    });
  });

  it('reports rate limiting as other, not unreachable', async () => {
    const ctx = ctxWith([]);
    const original = ctx.fetch;
    ctx.fetch = async (input) => {
      await original(input).catch(() => {});
      throw fetchFailure('rate-limited');
    };
    expect(await runTest(integration, ctx)).toEqual({
      ok: false,
      kind: 'other',
      message: 'Bazarr is rate limiting requests',
    });
  });

  it('reports another HTTP error as other', async () => {
    const ctx = ctxWith([{ match: { url: STATUS }, status: 500 }]);
    expect(await runTest(integration, ctx)).toEqual({
      ok: false,
      kind: 'other',
      message: 'Bazarr answered 500 for /api/system/status',
    });
  });

  it('reports a wrong product when no version comes back', async () => {
    for (const body of [status(), { data: { bazarr_version: 5 } }, 'hello', null]) {
      const ctx = ctxWith([{ match: { url: STATUS }, body }]);
      expect(await runTest(integration, ctx)).toEqual({
        ok: false,
        kind: 'wrong-product',
        message: 'the address answered, but it is not Bazarr',
      });
    }
  });

  it('reports a version below 1.4.0 as too old', async () => {
    const ctx = ctxWith([{ match: { url: STATUS }, body: status('v1.3.9') }]);
    expect(await runTest(integration, ctx)).toEqual({
      ok: false,
      kind: 'too-old',
      message: 'Bazarr 1.3.9 is too old; 1.4.0 or newer is required',
    });
  });

  it('compares versions numerically, not as text', async () => {
    const ctx = ctxWith([{ match: { url: STATUS }, body: status('v1.10.2') }]);
    expect(await runTest(integration, ctx)).toMatchObject({ ok: true, version: '1.10.2' });
  });
});
