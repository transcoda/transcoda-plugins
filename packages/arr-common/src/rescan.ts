import type { FinishRunContext, FinishRunResult } from '@transcoda/sdk';
import { type ArrProduct, arrClient } from './client.ts';
import { coalesce } from './coalesce.ts';
import { runCommand } from './command.ts';
import { describeFailure } from './errors.ts';
import type { JsonValue } from './json.ts';
import { sameFile } from './paths.ts';
import { notKnownMessage } from './roots.ts';

/** Several files of one item finishing within this window share one rescan command. */
const COALESCE_MS = 5000;

/** What the Rescan step acts on, as the plugin found it. */
export interface RescanTarget {
  /** True when the manager lists a file at the path the lookup was given. */
  hasFile: boolean;
  /** Coalescing key, one per item: `movie:11`, `series:1`. */
  key: string;
  /** The rescan command, e.g. `{ name: 'RescanMovie', movieId: 11 }`. */
  command: { name: string } & Record<string, JsonValue>;
  /** The item in failure messages: `Example Movie (2019)`, `Example Show`. */
  label: string;
  /** Appended to the success message: ` (Example Movie (2019))`, ` (S01E03)` or nothing. */
  listedSuffix: string;
  /** Appended to the "does not list" message: `; episode S01E03 may show as missing` or nothing. */
  missingSuffix: string;
  /** The item's files as the manager lists them now (read after the rescan, never cached). */
  files: () => Promise<{ path: string }[]>;
}

/**
 * Rescans the item that holds `ctx.originalPath` and checks that the manager then lists
 * `ctx.newPath`. `find` looks an item up by a local path, or gives null when no item covers it.
 * Never throws for an expected failure: those come back as `{ ok: false }`, retryable when a retry
 * could help (a timeout, a command whose status stayed unknown, an unreachable service).
 */
export async function rescanAndVerify(
  ctx: FinishRunContext,
  product: ArrProduct,
  timeoutSeconds: number,
  find: (localPath: string) => Promise<RescanTarget | null>,
): Promise<FinishRunResult> {
  const plugin = ctx.plugin;
  try {
    let viaNewPath = false;
    let found = await find(ctx.originalPath);
    if ((found === null || !found.hasFile) && ctx.newPath !== ctx.originalPath) {
      // A container change can leave the manager without the old entry already; the item is
      // still found by folder, and the rescan is what makes the manager list the new file.
      const viaNew = await find(ctx.newPath);
      if (viaNew !== null) {
        found = viaNew;
        viaNewPath = true;
      }
    }
    if (found === null || (!found.hasFile && !viaNewPath)) {
      const unknown = await notKnownMessage(
        plugin,
        product,
        plugin.paths.toRemote(ctx.originalPath),
      );
      return { ok: false, message: `${unknown}; nothing was rescanned` };
    }
    const target = found;
    const outcome = await coalesce(target.key, COALESCE_MS, () =>
      runCommand(plugin, arrClient(plugin, product), target.command, {
        timeoutMs: timeoutSeconds * 1000,
      }),
    );
    if (outcome.status === 'failed') {
      return {
        ok: false,
        ...(outcome.retryable ? { retryable: true } : {}),
        message: `${product} rescan of ${target.label} failed: ${outcome.message}`,
      };
    }
    if (outcome.status === 'timeout') {
      return {
        ok: false,
        retryable: true,
        message: `${product} rescan of ${target.label} did not finish within ${timeoutSeconds} s`,
      };
    }
    const newRemote = plugin.paths.toRemote(ctx.newPath);
    if ((await target.files()).some((f) => sameFile(f.path, newRemote))) {
      return { ok: true, message: `${product} lists ${newRemote}${target.listedSuffix}` };
    }
    return {
      ok: false,
      message: `${product} does not list ${newRemote} after rescan${target.missingSuffix}`,
    };
  } catch (e) {
    const failure = describeFailure(product, e);
    if (failure === null) throw e;
    return { ok: false, retryable: failure.retryable, message: failure.message };
  }
}
