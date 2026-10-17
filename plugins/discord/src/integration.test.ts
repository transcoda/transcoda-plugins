import { FetchTimeout } from '@transcoda/sdk';
import { fakePluginContext, runTest, type ScriptedResponse } from '@transcoda/sdk/testing';
import { describe, expect, it } from 'vitest';
import { integration, webhookShape } from './integration.ts';

const URL_OK = 'https://discord.com/api/webhooks/123456/abc_DEF-9';
const ctx = (webhookUrl: string, responses: ScriptedResponse[] = []) =>
  fakePluginContext({ settings: { webhookUrl }, responses });

describe('webhookShape', () => {
  it('accepts only the discord.com webhook form', () => {
    expect(webhookShape(URL_OK)).toBe(true);
    for (const bad of [
      'http://discord.com/api/webhooks/1/a',
      'https://discordapp.com/api/webhooks/1/a',
      'https://discord.com/api/webhooks/x/a',
      'https://discord.com/api/webhooks/1/a/b',
      'https://discord.com/api/webhooks/1/a?x=1',
      'https://evil.example/https://discord.com/api/webhooks/1/a',
    ]) {
      expect(webhookShape(bad)).toBe(false);
    }
  });
});

describe('integration', () => {
  it('declares the discord.com origin and a secret webhook url', () => {
    expect(integration.allowedOrigins).toEqual(['https://discord.com']);
    expect(integration.settings.parse({ webhookUrl: URL_OK })).toEqual({
      webhookUrl: URL_OK,
      notifyOnFailed: false,
      username: 'Transcoda',
    });
  });

  it('refuses a bad shape without any request', async () => {
    const c = ctx('https://example.com/hook');
    expect(await runTest(integration, c)).toEqual({
      ok: false,
      kind: 'other',
      message: 'The webhook URL must look like https://discord.com/api/webhooks/<id>/<token>',
    });
    expect(c.calls).toHaveLength(0);
  });

  it('reports the webhook name and channel', async () => {
    const c = ctx(URL_OK, [
      { match: { url: URL_OK, method: 'GET' }, body: { name: 'Transcoda', channel_id: '99' } },
    ]);
    expect(await runTest(integration, c)).toEqual({
      ok: true,
      message: 'Webhook "Transcoda" in channel 99',
    });
  });

  it('maps 401 and 404 to unauthorized', async () => {
    for (const status of [401, 404]) {
      const c = ctx(URL_OK, [
        { match: { url: URL_OK }, status, body: { message: 'Unknown Webhook' } },
      ]);
      expect(await runTest(integration, c)).toEqual({
        ok: false,
        kind: 'unauthorized',
        message: 'Discord does not know this webhook',
      });
    }
  });

  it('maps other statuses and fetch errors', async () => {
    const other = ctx(URL_OK, [{ match: { url: URL_OK }, status: 500 }]);
    expect(await runTest(integration, other)).toMatchObject({
      ok: false,
      kind: 'other',
      message: 'Discord answered 500',
    });
    const unreachable = ctx(URL_OK);
    expect(await runTest(integration, unreachable)).toMatchObject({
      ok: false,
      kind: 'unreachable',
    });
    const timeout = {
      ...ctx(URL_OK),
      fetch: async () => {
        throw new FetchTimeout('slow');
      },
    };
    expect(await runTest(integration, timeout)).toMatchObject({
      ok: false,
      kind: 'unreachable',
      message: 'Discord unreachable: timeout',
    });
  });

  it('treats a 200 without a name as the wrong thing', async () => {
    const c = ctx(URL_OK, [{ match: { url: URL_OK }, body: { foo: 1 } }]);
    expect(await runTest(integration, c)).toMatchObject({ ok: false, kind: 'other' });
  });
});
