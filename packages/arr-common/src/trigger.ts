// The import trigger Sonarr and Radarr share: their Webhook connection (On File Import, On File
// Upgrade) posts here through Transcoda, which has checked the token already. The body is
// untrusted: anything that is not an import with an absolute file path is ignored, and Transcoda
// queues a path only when it lies inside one of its libraries.
import { defineTrigger, type PluginContext, type TriggerResult } from '@transcoda/sdk';
import { z } from 'zod';

/** The plugin name, which is also the trigger URL's plugin part. */
type Product = 'sonarr' | 'radarr';

const NAMES: Record<Product, string> = { sonarr: 'Sonarr', radarr: 'Radarr' };
const MAX_NOTE = 200;

type Obj = { [key: string]: unknown };
const asObject = (v: unknown): Obj | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null;
const asString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** An absolute POSIX path without `..` segments, or null. */
function cleanPath(p: string | null): string | null {
  if (p === null || !p.startsWith('/') || p.includes('\0')) return null;
  return p.split('/').includes('..') ? null : p;
}

/** The imported file's path as the product sees it: `path`, else its folder plus `relativePath`. */
function remotePathOf(file: Obj, folder: string | null): string | null {
  const direct = cleanPath(asString(file.path));
  if (direct !== null) return direct;
  const relative = asString(file.relativePath);
  if (folder === null || relative === null || relative.startsWith('/')) return null;
  return cleanPath(`${folder.replace(/\/+$/, '')}/${relative}`);
}

const pad = (n: unknown) => (typeof n === 'number' ? String(n).padStart(2, '0') : '??');

/** What the job's note says was imported: `Example Show S01E01`, `Example Movie (2019)`. */
function titleOf(product: Product, body: Obj): string {
  if (product === 'sonarr') {
    const series = asString(asObject(body.series)?.title) ?? 'a series';
    const episode = Array.isArray(body.episodes) ? asObject(body.episodes[0]) : null;
    return episode
      ? `${series} S${pad(episode.seasonNumber)}E${pad(episode.episodeNumber)}`
      : series;
  }
  const movie = asObject(body.movie);
  const title = asString(movie?.title) ?? 'a movie';
  return typeof movie?.year === 'number' && movie.year > 0 ? `${title} (${movie.year})` : title;
}

function handle(product: Product, ctx: PluginContext, raw: unknown): TriggerResult {
  const name = NAMES[product];
  const body = asObject(raw);
  const event = asString(body?.eventType);
  if (body === null || event === null) {
    return { kind: 'ignore', reason: `not a ${name} webhook` };
  }
  if (event === 'Test') {
    return {
      kind: 'test',
      message: `${name} reached Transcoda; imports and upgrades will be queued`,
    };
  }
  // "Download" is what Sonarr and Radarr call On File Import and On File Upgrade.
  if (event !== 'Download') {
    return { kind: 'ignore', reason: `${name} event ${event.slice(0, 50)} does not import a file` };
  }
  const file = asObject(product === 'sonarr' ? body.episodeFile : body.movieFile);
  const folder =
    product === 'sonarr'
      ? cleanPath(asString(asObject(body.series)?.path))
      : cleanPath(asString(asObject(body.movie)?.folderPath));
  const remote = file ? remotePathOf(file, folder) : null;
  if (file === null || remote === null) {
    return { kind: 'ignore', reason: `${name} sent an import without a file path` };
  }
  const verb = body.isUpgrade === true ? 'upgraded' : 'imported';
  const note = `${name} ${verb} ${titleOf(product, body)}`.slice(0, MAX_NOTE);
  const id = typeof file.id === 'number' ? `${product}:${file.id}` : undefined;
  return {
    kind: 'files',
    files: [{ path: ctx.paths.toLocal(remote), note, ...(id ? { dedupKey: id } : {}) }],
  };
}

/** Sonarr's or Radarr's import trigger: `POST /api/triggers/<product>/import` on Transcoda. */
export function importTrigger(product: Product) {
  const name = NAMES[product];
  return defineTrigger({
    id: 'import',
    title: `Import from ${name}`,
    description: `Queues a file the moment ${name} imports or upgrades it (a Webhook connection in ${name}).`,
    icon: 'download',
    settings: z.object({}),
    auth: { basic: true },
    async handle(ctx, request) {
      return handle(product, ctx, request.body);
    },
  });
}
