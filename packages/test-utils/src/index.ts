// Test helpers shared by every plugin's tests. Only test files and a plugin's src/test-util.ts may
// import this package (`pnpm check-plugins` enforces it), so none of it reaches a bundle.
import type { FakePluginContext } from '@transcoda/sdk/testing';
import { expect } from 'vitest';

export interface SecretHygieneOptions {
  /** Every call's `auth` must equal this, e.g. `{ header: { name: 'X-Api-Key', value: KEY } }`. Omit to skip. */
  auth?: unknown;
  /** The request URL is itself the secret (a Discord webhook), so URLs are not checked. Default false. */
  secretInUrl?: boolean;
  /** At least one request must have been made, so a test cannot pass by doing nothing. Default true. */
  requireCalls?: boolean;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
}

/**
 * Fails when any of `secrets` shows up where a person or a log could read it: a log line, one of
 * `outputs` (results, messages, thrown errors' messages), or a request's URL, headers or body. A
 * secret may only travel in a request's structured `auth`, which the host fills in.
 */
export function assertSecretHygiene(
  ctx: Pick<FakePluginContext, 'logs' | 'calls'>,
  secrets: string | readonly string[],
  outputs: readonly unknown[] = [],
  options: SecretHygieneOptions = {},
): void {
  const needles = typeof secrets === 'string' ? [secrets] : secrets;
  if (options.requireCalls ?? true) expect(ctx.calls.length).toBeGreaterThan(0);
  for (const secret of needles) {
    for (const [, line] of ctx.logs) expect(line).not.toContain(secret);
    for (const output of outputs) expect(text(output)).not.toContain(secret);
    for (const call of ctx.calls) {
      if (!options.secretInUrl) expect(call.url).not.toContain(secret);
      expect(JSON.stringify(call.headers ?? {})).not.toContain(secret);
      expect(JSON.stringify(call.body ?? null)).not.toContain(secret);
    }
  }
  if ('auth' in options) for (const call of ctx.calls) expect(call.auth).toEqual(options.auth);
}
