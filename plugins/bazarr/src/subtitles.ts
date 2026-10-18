import type { JsonValue } from '@transcoda/plugin-arr-common';
import type { PluginContext } from '@transcoda/sdk';
import { z } from 'zod';

export interface BazarrSubtitle {
  /** ISO 639-2/T, or 'unknown'. */
  language: string | 'unknown';
  /** A subtitle file next to the video; false for a track inside it. */
  external: boolean;
  forced: boolean;
  sdh: boolean;
}

export const INCLUDE = ['all', 'external', 'embedded'] as const;
export type Include = (typeof INCLUDE)[number];
export const includeSetting = () =>
  z
    .enum(INCLUDE)
    .default('all')
    .describe('Which subtitles count: all, files next to the video, or tracks inside it');

const isObj = (v: JsonValue | undefined): v is { [k: string]: JsonValue } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Bazarr sends booleans in some versions and 'True'/'False' strings in others. */
function flag(v: JsonValue | undefined): boolean {
  return v === true || (typeof v === 'string' && v.toLowerCase() === 'true');
}

const code = (v: JsonValue | undefined): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/** B4: the `subtitles` array of an episode or movie, normalised. */
export function subtitlesOf(ctx: PluginContext, raw: JsonValue | undefined): BazarrSubtitle[] {
  if (!Array.isArray(raw)) return [];
  const out: BazarrSubtitle[] = [];
  for (const row of raw) {
    if (!isObj(row)) continue;
    let language: string = 'unknown';
    for (const candidate of [code(row.code3), code(row.code2)]) {
      if (candidate === null) continue;
      language = ctx.lang.normalise(candidate);
      if (language !== 'unknown') break;
    }
    out.push({
      language,
      external: typeof row.path === 'string' && row.path !== '',
      forced: flag(row.forced),
      sdh: flag(row.hi),
    });
  }
  return out;
}

export function summary(
  subs: BazarrSubtitle[],
  include: Include,
): { languages: string[]; forced: boolean; sdh: boolean } {
  const counted = subs.filter((s) => include === 'all' || (include === 'external') === s.external);
  const languages = [...new Set(counted.map((s) => s.language).filter((l) => l !== 'unknown'))];
  return {
    languages: languages.sort(),
    forced: counted.some((s) => s.forced),
    sdh: counted.some((s) => s.sdh),
  };
}
