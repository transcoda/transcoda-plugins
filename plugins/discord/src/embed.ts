export interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}

export interface Embed {
  title: string;
  description: string;
  url?: string;
  color: number;
  fields: EmbedField[];
}

export interface EmbedInput {
  workflowName: string;
  path: string;
  outcome: string;
  beforeBytes: number | null;
  afterBytes: number | null;
  problems: string[];
  reason: string | null;
  jobUrl: string | null;
}

const COLOR_CLEAN = 0x2e7d32;
const COLOR_PROBLEMS = 0xb26a00;
const COLOR_FAILED = 0xc62828;

const TITLE_MAX = 256;
const DESCRIPTION_MAX = 4096;
const FIELD_MAX = 1024;

/** Cuts to `max` code points (never splits a surrogate pair), ending in an ellipsis when it cut. */
export function truncate(s: string, max: number): string {
  const points = Array.from(s);
  return points.length <= max ? s : `${points.slice(0, max - 1).join('')}…`;
}

const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'];

/** The unit index that suits `bytes` (decimal units). */
function unitFor(bytes: number): number {
  let unit = 0;
  let value = bytes;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return unit;
}

function inUnit(bytes: number, unit: number): string {
  return unit === 0 ? `${bytes} B` : `${(bytes / 1000 ** unit).toFixed(1)} ${UNITS[unit]}`;
}

/** `1.2 GB → 0.9 GB (−25 %)`: both sizes in the larger one's unit; no percentage when the old size is 0. */
export function formatSize(before: number, after: number): string {
  const unit = unitFor(Math.max(before, after));
  const line = `${inUnit(before, unit)} → ${inUnit(after, unit)}`;
  if (before <= 0) return line;
  const pct = Math.round(((after - before) / before) * 100);
  const text = pct < 0 ? `−${-pct}` : pct > 0 ? `+${pct}` : '0';
  return `${line} (${text} %)`;
}

function basename(path: string): string {
  const parts = path.split('/').filter((p) => p !== '');
  return parts[parts.length - 1] ?? path;
}

export function buildEmbed(input: EmbedInput): Embed {
  const failed = input.outcome === 'failed';
  const fields: EmbedField[] = [
    { name: 'Result', value: truncate(input.outcome, FIELD_MAX), inline: true },
  ];
  if (input.beforeBytes !== null && input.afterBytes !== null) {
    fields.push({
      name: 'Size',
      value: truncate(formatSize(input.beforeBytes, input.afterBytes), FIELD_MAX),
      inline: true,
    });
  }
  const problems = input.problems.map((p) => p.trim()).filter((p) => p !== '');
  if (problems.length > 0) {
    fields.push({
      name: 'Needs attention',
      value: truncate(problems.join('\n'), FIELD_MAX),
      inline: false,
    });
  } else if (input.reason !== null && input.reason !== '') {
    fields.push({ name: 'Reason', value: truncate(input.reason, FIELD_MAX), inline: false });
  }
  const embed: Embed = {
    title: truncate(input.workflowName, TITLE_MAX),
    description: truncate(basename(input.path), DESCRIPTION_MAX),
    color: failed ? COLOR_FAILED : problems.length > 0 ? COLOR_PROBLEMS : COLOR_CLEAN,
    fields,
  };
  if (input.jobUrl !== null) embed.url = input.jobUrl;
  return embed;
}
