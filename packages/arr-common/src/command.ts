import type { PluginContext } from '@transcoda/sdk';
import { type ArrClient, ArrHttpError } from './client.ts';
import { fetchKindOf } from './fetch-kind.ts';
import type { JsonValue } from './json.ts';

export type CommandOutcome =
  | { status: 'completed' }
  | { status: 'failed'; message: string; retryable?: true }
  | { status: 'timeout' };

const FAILED = new Set(['failed', 'aborted', 'cancelled', 'orphaned']);

export async function runCommand(
  _ctx: PluginContext,
  client: ArrClient,
  body: { name: string } & Record<string, JsonValue>,
  opts: {
    timeoutMs: number;
    pollMs?: number;
    // Test seams: a fake clock and a no-wait sleep.
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<CommandOutcome> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 2000;
  const deadline = now() + opts.timeoutMs;
  const created = await client.post('/api/v3/command', body);
  const id =
    typeof created === 'object' && created !== null && !Array.isArray(created)
      ? created.id
      : undefined;
  if (typeof id !== 'number') {
    return { status: 'failed', message: `command ${body.name} was not accepted` };
  }
  let lastError: string | null = null;
  for (;;) {
    if (now() >= deadline) {
      // Polls kept failing to the end: say why instead of a bare timeout.
      return lastError === null
        ? { status: 'timeout' }
        : {
            status: 'failed',
            message: `command ${body.name} status unknown: ${lastError}`,
            retryable: true,
          };
    }
    let res: JsonValue;
    try {
      res = await client.get(`/api/v3/command/${id}`);
    } catch (e) {
      if (!(fetchKindOf(e) !== null || e instanceof ArrHttpError)) throw e;
      // A transient poll failure does not end the step; keep trying until the deadline.
      lastError = (e as Error).message;
      await sleep(Math.max(0, Math.min(pollMs, deadline - now())));
      continue;
    }
    lastError = null;
    const obj =
      typeof res === 'object' && res !== null && !Array.isArray(res) ? res : ({} as never);
    const status = typeof obj.status === 'string' ? obj.status : '';
    if (status === 'completed') return { status: 'completed' };
    if (FAILED.has(status)) {
      const exception = typeof obj.exception === 'string' ? obj.exception : '';
      const detail = exception ? `: ${exception.slice(0, 200)}` : '';
      return { status: 'failed', message: `command ${body.name} ended ${status}${detail}` };
    }
    // queued, started, or a value this version does not know: keep polling until the timeout.
    await sleep(Math.max(0, Math.min(pollMs, deadline - now())));
  }
}
