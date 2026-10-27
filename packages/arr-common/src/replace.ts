import { type FinishRunContext, type FinishRunResult, fetchErrorKind } from '@transcoda/sdk';
import { type ArrClient, ArrHttpError, type ArrProduct } from './client.ts';
import {
  type BlocklistItem,
  importedGrab,
  itemHistory,
  latestImport,
  REQUEST_WINDOW_MS,
  recentBlocklisted,
  recentMarkedFailed,
} from './history.ts';
import type { JsonValue } from './json.ts';
import { unmonitorWarning } from './unmonitor.ts';

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
  /**
   * Setting the item monitored again after the delete, when the manager's "unmonitor deleted"
   * setting is on: `PUT put` with `body`, merged into the record read from `mergeInto` first
   * when given (Radarr's movie endpoint wants the whole movie).
   */
  remonitor: {
    setting: 'movies' | 'episodes';
    /** `the movie`, `the episodes`, for the message. */
    what: string;
    put: string;
    body: Record<string, JsonValue>;
    mergeInto?: string;
  };
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

/** What a step is called once something changed, and what is left to do by hand when it fails. */
interface Pending {
  doing: string;
  todo: string;
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

const isObj = (v: JsonValue): v is { [k: string]: JsonValue } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * After a damaged source: find the item, stop when it was already requested within 7 days (a
 * `downloadFailed` history event or a blocklist entry newer than the latest import), mark the grab
 * that produced the file failed (which blocklists the release), delete the file through the
 * manager (its recycle bin applies), monitor the item again when the manager unmonitors deleted
 * files, and start a search.
 *
 * Stops at the first failed step and says which steps happened. Once something changed (the
 * blocklist or the delete), a failure is not retryable: a retry would stop at the 7-day check on
 * its own `downloadFailed`, or no longer find the file. The message then says what is left to do.
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
  let changed = false;
  let pending: Pending | null = null;
  try {
    const target = await step(product, 'find', find);
    if (target === null) {
      return { ok: false, message: `${product} does not know this file; nothing was changed` };
    }
    done.push(`found ${target.label}`);
    const episodeIds = target.episodeIds;
    const only = episodeIds === undefined ? {} : { episodeIds };
    const window = { now: Date.now(), windowMs: REQUEST_WINDOW_MS };

    const { events, earlier } = await step(product, '7-day check', async () => {
      const events = await itemHistory(client, target.historyPath);
      const imported = latestImport(events, only);
      const marked = recentMarkedFailed(events, { ...only, ...window });
      return {
        events,
        earlier:
          marked ??
          (await recentBlocklisted(client, target.blocklist, {
            ...window,
            ...(imported === null ? {} : { after: Date.parse(imported.date) }),
          })),
      };
    });
    if (earlier !== null) {
      return {
        ok: true,
        message: `${product}: ${target.label} was already requested on ${day(earlier.date)}; nothing was changed`,
      };
    }

    const grab = importedGrab(events, only);
    if (grab === null) {
      done.push('release couldn’t be blocklisted (no grab in history)');
    } else {
      await step(product, 'blocklist', () => client.post(`/api/v3/history/failed/${grab.id}`));
      done.push(`marked the grab of "${grab.sourceTitle}" failed (blocklisted)`);
      changed = true;
    }

    pending = { doing: 'deleting the file', todo: `delete it and search in ${product}` };
    await step(product, 'delete', () => client.delete(target.deletePath));
    done.push(`deleted ${target.remotePath}`);
    changed = true;

    const { remonitor } = target;
    pending = {
      doing: `monitoring ${remonitor.what} again`,
      todo: `monitor it and search in ${product}`,
    };
    const remonitored = await step(product, 're-monitor', async () => {
      const config = await client.get('/api/v3/config/mediamanagement');
      if (unmonitorWarning(config, remonitor.setting).warning === null) return false;
      let body: JsonValue = remonitor.body;
      if (remonitor.mergeInto !== undefined) {
        const current = await client.get(remonitor.mergeInto);
        if (!isObj(current)) {
          throw new StepFailed(
            're-monitor',
            false,
            `${product} returned no record for ${remonitor.mergeInto}`,
          );
        }
        body = { ...current, ...remonitor.body };
      }
      await client.put(remonitor.put, body);
      return true;
    });
    if (remonitored) done.push(`monitored ${remonitor.what} again`);

    pending = { doing: 'starting the search', todo: `search in ${product}` };
    const created = await step(product, 'search', () =>
      client.post('/api/v3/command', target.search),
    );
    const id = isObj(created) ? created.id : undefined;
    if (typeof id !== 'number') {
      throw new StepFailed('search', false, `command ${target.search.name} was not accepted`);
    }
    done.push('started a search');
    return { ok: true, message: `${product}: ${done.join('; ')}` };
  } catch (e) {
    if (!(e instanceof StepFailed)) throw e;
    if (changed && pending !== null) {
      return {
        ok: false,
        message: `${product}: ${done.join('; ')}; ${pending.doing} failed: ${e.message} — ${pending.todo}`,
      };
    }
    return {
      ok: false,
      ...(e.retryable ? { retryable: true } : {}),
      message: `${e.step} failed: ${e.message}; done: ${done.join('; ') || 'nothing'}`,
    };
  }
}
