import { type FinishRunContext, type FinishRunResult, fetchErrorKind } from '@transcoda/sdk';
import { type ArrClient, ArrHttpError, type ArrProduct } from './client.ts';
import {
  type BlocklistItem,
  itemHistory,
  latestGrab,
  REQUEST_WINDOW_MS,
  recentBlocklisted,
  recentMarkedFailed,
} from './history.ts';
import type { JsonValue } from './json.ts';

/** What the Replace damaged file steps act on, as the plugin found it. */
export interface ReplaceTarget {
  /** `Example Movie (2019)`, `Example Show S01E03`. */
  label: string;
  /** The item's history (see `itemHistory`). */
  historyPath: string;
  /** Sonarr: the episodes held in the file; history and blocklist entries count only for them. */
  episodeIds?: number[];
  blocklist: BlocklistItem;
  /** The file as the manager lists it, for the message. */
  remotePath: string;
  /** `DELETE` path of the file record, e.g. `/api/v3/moviefile/<id>`. */
  deletePath: string;
  search: { name: string } & Record<string, JsonValue>;
}

class StepFailed extends Error {
  constructor(
    readonly step: string,
    readonly retryable: boolean,
    why: string,
  ) {
    super(why);
  }
}

/** A short, secret-free reason for an expected failure; null for a programming error. */
function describe(product: ArrProduct, e: unknown): { message: string; retryable: boolean } | null {
  const kind = fetchErrorKind(e);
  if (kind !== null)
    return { message: `${product} unreachable: ${kind}`, retryable: kind !== 'refused' };
  if (e instanceof ArrHttpError) return { message: e.message, retryable: e.status >= 500 };
  return null;
}

async function step<T>(product: ArrProduct, name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const failure = describe(product, e);
    if (failure === null) throw e;
    throw new StepFailed(name, failure.retryable, failure.message);
  }
}

const day = (date: string) => new Date(Date.parse(date)).toISOString().slice(0, 10);

/**
 * After a damaged source: find the item, stop when it was already requested within 7 days (a
 * `downloadFailed` history event or a blocklist entry), mark the grab failed (which blocklists the
 * release), delete the file through the manager (its recycle bin applies) and start a search.
 * Stops at the first failed step and says which steps happened.
 */
export async function replaceDamagedFile(
  ctx: FinishRunContext,
  product: ArrProduct,
  client: ArrClient,
  find: () => Promise<ReplaceTarget | null>,
): Promise<FinishRunResult> {
  if (ctx.outcome !== 'damaged') {
    return { ok: false, message: 'Replace damaged file only runs after a damaged source' };
  }
  const done: string[] = [];
  try {
    const target = await step(product, 'find', find);
    if (target === null) {
      return { ok: false, message: `${product} does not know this file; nothing was changed` };
    }
    done.push(`found ${target.label}`);
    const episodeIds = target.episodeIds;
    const window = { now: Date.now(), windowMs: REQUEST_WINDOW_MS };

    const { events, earlier } = await step(product, '7-day check', async () => {
      const events = await itemHistory(client, target.historyPath);
      const marked = recentMarkedFailed(events, {
        ...(episodeIds === undefined ? {} : { episodeIds }),
        ...window,
      });
      return {
        events,
        earlier: marked ?? (await recentBlocklisted(client, target.blocklist, window)),
      };
    });
    if (earlier !== null) {
      return {
        ok: true,
        message: `${product}: ${target.label} was already requested on ${day(earlier.date)}; nothing was changed`,
      };
    }

    const grab = latestGrab(events, episodeIds === undefined ? {} : { episodeIds });
    if (grab === null) {
      done.push('release couldn’t be blocklisted (no grab in history)');
    } else {
      await step(product, 'blocklist', () => client.post(`/api/v3/history/failed/${grab.id}`));
      done.push(`marked the grab of "${grab.sourceTitle}" failed (blocklisted)`);
    }

    await step(product, 'delete', () => client.delete(target.deletePath));
    done.push(`deleted ${target.remotePath}`);

    const created = await step(product, 'search', () =>
      client.post('/api/v3/command', target.search),
    );
    const id =
      typeof created === 'object' && created !== null && !Array.isArray(created)
        ? created.id
        : undefined;
    if (typeof id !== 'number') {
      throw new StepFailed('search', false, `command ${target.search.name} was not accepted`);
    }
    done.push('started a search');
    return { ok: true, message: `${product}: ${done.join('; ')}` };
  } catch (e) {
    if (!(e instanceof StepFailed)) throw e;
    return {
      ok: false,
      ...(e.retryable ? { retryable: true } : {}),
      message: `${e.step} failed: ${e.message}; done: ${done.join('; ') || 'nothing'}`,
    };
  }
}
