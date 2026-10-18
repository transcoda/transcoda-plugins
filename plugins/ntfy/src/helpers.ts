import { FetchTimeout, type HookJob } from '@transcoda/sdk';
import {
  type FakePluginContext,
  fakeHookContext,
  fakePluginContext,
  type ScriptedResponse,
} from '@transcoda/sdk/testing';

export const SENTINEL = 'SENTINEL-SECRET-9f3a';

export function runContext(
  plugin: FakePluginContext,
  over: Partial<{
    problemsSoFar: string[];
    jobUrl: string | null;
    newPath: string;
    outcome: 'replaced' | 'moved' | 'copied';
  }> = {},
) {
  return {
    ...fakeHookContext({ plugin }),
    originalPath: '/data/shows/Show/S01E01.mkv',
    newPath: '/data/shows/Show/S01E01.mkv',
    replacedTo: 'recycle' as const,
    beforeBytes: 1_200_000_000,
    afterBytes: 900_000_000,
    outcome: 'replaced' as const,
    containerChanged: false,
    problemsSoFar: [] as string[],
    jobUrl: null as string | null,
    ...over,
  };
}

export const publishOk = (status = 200): ScriptedResponse => ({
  match: { url: 'https://ntfy.example/', method: 'POST' },
  status,
  body: {},
});

export function ctxWith(
  settings: Record<string, string | boolean | number> = {},
  responses: ScriptedResponse[] = [publishOk()],
) {
  return fakePluginContext({ settings: { url: 'https://ntfy.example', ...settings }, responses });
}

export const job: HookJob = {
  id: 'j1',
  runId: 'r1',
  workflowId: 'w1',
  workflowName: 'Shrink',
  workflowVersion: 1,
  path: '/data/shows/Show/S01E01.mkv',
  outcome: 'failed',
  reason: 'ffmpeg exited 1',
  beforeBytes: null,
  afterBytes: null,
  replacedTo: null,
  problems: [],
  dryRun: false,
  jobUrl: 'https://transcoda.example/jobs/j1',
};

/** A context whose fetch always throws a timeout. */
export function timingOut(settings: Record<string, string | boolean | number> = {}) {
  const ctx = ctxWith(settings, []);
  ctx.fetch = async (input) => {
    ctx.calls.push(input);
    throw new FetchTimeout('timed out');
  };
  return ctx;
}

/** The JSON body of the n-th recorded call. */
export function bodyOf(
  ctx: FakePluginContext,
  n = 0,
): Record<string, unknown> & { message: string; title: string } {
  const body = ctx.calls[n]?.body;
  if (body === null || typeof body !== 'object') throw new Error(`call ${n} has no JSON body`);
  return body as never;
}
