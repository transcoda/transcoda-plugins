import type { JsonValue } from './json.ts';

export function idsOf(obj: JsonValue): { tmdbId?: number; tvdbId?: number; imdbId?: string } {
  const out: { tmdbId?: number; tvdbId?: number; imdbId?: string } = {};
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return out;
  const positive = (v: JsonValue | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (positive(obj.tmdbId)) out.tmdbId = obj.tmdbId;
  if (positive(obj.tvdbId)) out.tvdbId = obj.tvdbId;
  const imdb = obj.imdbId;
  if (typeof imdb === 'string' && /^tt.+/.test(imdb)) out.imdbId = imdb;
  return out;
}
