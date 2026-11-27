import {
  fetchErrorKind,
  type IntegrationTestFail,
  type IntegrationTestOk,
  type PluginContext,
} from '@transcoda/sdk';
import { ArrHttpError, type ArrProduct, arrClient } from './client.ts';
import { unmonitorWarning } from './unmonitor.ts';

function originOf(ctx: PluginContext): string {
  try {
    return new URL(String(ctx.settings.url ?? '')).origin;
  } catch {
    return 'the configured address';
  }
}

export async function testStatus(
  ctx: PluginContext,
  product: ArrProduct,
  minMajor: number,
): Promise<IntegrationTestOk | IntegrationTestFail> {
  const origin = originOf(ctx);
  let body: unknown;
  try {
    body = await arrClient(ctx, product).get('/api/v3/system/status');
  } catch (e) {
    if (e instanceof ArrHttpError) {
      if (e.status === 401 || e.status === 403) {
        return { ok: false, kind: 'unauthorized', message: `${product} rejected the API key` };
      }
      return { ok: false, kind: 'other', message: e.message };
    }
    const fetchKind = fetchErrorKind(e);
    if (fetchKind !== null && fetchKind !== 'rate-limited') {
      return {
        ok: false,
        kind: 'unreachable',
        message: `${product} is not reachable at ${origin}: ${fetchKind}`,
      };
    }
    if (fetchKind !== null) {
      return { ok: false, kind: 'other', message: `${product} is rate limiting requests` };
    }
    throw e;
  }
  const obj = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  if (obj.appName !== product) {
    return {
      ok: false,
      kind: 'wrong-product',
      message: `the address answered, but it is not ${product}`,
    };
  }
  const version = typeof obj.version === 'string' ? obj.version : '';
  const major = Number.parseInt(version, 10);
  if (!Number.isFinite(major) || major < minMajor) {
    return {
      ok: false,
      kind: 'too-old',
      message: `${product} ${version || '(unknown version)'} is too old; ${minMajor}.0 or newer is required`,
    };
  }
  return { ok: true, message: `${product} ${version} at ${origin}`, version };
}

const UNMONITOR_SETTING = { Sonarr: 'episodes', Radarr: 'movies' } as const;

/**
 * The integration test for Sonarr and Radarr: the status check, then a warning when the service
 * unmonitors what it deletes (or when its media management settings cannot be read).
 */
export async function arrIntegrationTest(
  ctx: PluginContext,
  product: ArrProduct,
): Promise<IntegrationTestOk | IntegrationTestFail> {
  const result = await testStatus(ctx, product, 4);
  if (!result.ok) return result;
  try {
    const config = await arrClient(ctx, product).get('/api/v3/config/mediamanagement');
    const { warning, fieldSeen } = unmonitorWarning(config, UNMONITOR_SETTING[product]);
    if (fieldSeen === null) {
      const keys =
        typeof config === 'object' && config !== null && !Array.isArray(config)
          ? Object.keys(config).join(', ')
          : '(not an object)';
      await ctx.log('debug', `unmonitor setting not found in mediamanagement; keys: ${keys}`);
    }
    return warning === null ? result : { ...result, warnings: [warning] };
  } catch (e) {
    const why = e instanceof ArrHttpError ? String(e.status) : fetchErrorKind(e);
    if (why === null) throw e;
    return { ...result, warnings: [`could not read media management settings: ${why}`] };
  }
}
