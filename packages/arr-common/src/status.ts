import {
  fetchErrorKind,
  type IntegrationTestFail,
  type IntegrationTestOk,
  type PluginContext,
} from '@transcoda/sdk';
import { ArrHttpError, type ArrProduct, arrClient } from './client.ts';

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
