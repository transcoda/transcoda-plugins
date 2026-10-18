import { integrationMetadata, secretPaths } from '@transcoda/sdk';
import { fakePluginContext, runTest } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { integration } from './integration.ts';

const health = (status: number, body: unknown) => ({
  match: { url: 'https://ntfy.example/v1/health', method: 'GET' },
  status,
  body: body as never,
});

describe('ntfy integration', () => {
  it('defaults to ntfy.sh and marks only the token as secret', () => {
    const meta = integrationMetadata(integration);
    expect(meta.allowedOrigins).toEqual(['$settings.url']);
    expect(secretPaths(meta.settingsSchema)).toEqual(['token']);
    const parsed = integration.settings.parse({});
    expect(parsed).toMatchObject({
      url: 'https://ntfy.sh',
      notifyOnFailed: false,
      failedTopic: 'transcoda',
    });
  });

  it('reports a healthy server', async () => {
    const ctx = fakePluginContext({
      settings: { url: 'https://ntfy.example/' },
      responses: [health(200, { healthy: true })],
    });
    expect(await runTest(integration, ctx)).toEqual({
      ok: true,
      message: 'ntfy at https://ntfy.example is healthy',
    });
  });

  it('publishes nothing even with a token', async () => {
    const ctx = fakePluginContext({
      settings: { url: 'https://ntfy.example', token: 'tk_x' },
      responses: [health(200, { healthy: true })],
    });
    await runTest(integration, ctx);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]?.method ?? 'GET').toBe('GET');
  });

  it('reports an unreachable server', async () => {
    const ctx = fakePluginContext({ settings: { url: 'https://ntfy.example' } });
    expect(await runTest(integration, ctx)).toMatchObject({ ok: false, kind: 'unreachable' });
  });

  it('reports a server that is not healthy', async () => {
    const ctx = fakePluginContext({
      settings: { url: 'https://ntfy.example' },
      responses: [health(200, { healthy: false })],
    });
    expect(await runTest(integration, ctx)).toMatchObject({ ok: false, kind: 'other' });
  });

  it('reports a non-ntfy answer', async () => {
    const ctx = fakePluginContext({
      settings: { url: 'https://ntfy.example' },
      responses: [health(404, null)],
    });
    expect(await runTest(integration, ctx)).toMatchObject({ ok: false, kind: 'other' });
  });

  it('classifies a foreign error class by its kind', async () => {
    class HostFailed extends Error {
      readonly kind = 'refused';
    }
    const ctx = fakePluginContext({ settings: { url: 'https://ntfy.example' } });
    ctx.fetch = async () => {
      throw new HostFailed('x');
    };
    expect(await runTest(integration, ctx)).toEqual({
      ok: false,
      kind: 'unreachable',
      message: 'ntfy unreachable: refused',
    });
  });

  it('classifies a plain Object.assign error by kind', async () => {
    const ctx = fakePluginContext({ settings: { url: 'https://ntfy.example' } });
    ctx.fetch = async () => {
      throw Object.assign(new Error('x'), { kind: 'timeout' });
    };
    expect(await runTest(integration, ctx)).toMatchObject({
      ok: false,
      kind: 'unreachable',
      message: 'ntfy unreachable: timeout',
    });
  });
});
