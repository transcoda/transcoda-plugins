/** Drops trailing slashes in linear time (a `/\/+$/` regex is quadratic on many slashes). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end--;
  return s.slice(0, end);
}
export interface MessageInput {
  workflowName: string;
  path: string;
  outcome: string;
  beforeBytes: number | null;
  afterBytes: number | null;
  problems: string[];
  reason: string | null;
}

/** Largest message body we send; ntfy's own default limit is 4096 bytes. */
export const MAX_MESSAGE_BYTES = 4000;

export function basename(path: string): string {
  const trimmed = stripTrailingSlashes(path);
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || path;
}

/** Both sizes share one unit (GB when either is a gigabyte or more) so they read side by side. */
function formatPair(before: number, after: number): string {
  const [div, unit] = Math.max(before, after) >= 1e9 ? [1e9, 'GB'] : [1e6, 'MB'];
  return `${(before / div).toFixed(1)} ${unit} → ${(after / div).toFixed(1)} ${unit}`;
}

function formatChange(before: number, after: number): string {
  if (before <= 0) return '';
  const pct = Math.round(((after - before) / before) * 100);
  const sign = pct < 0 ? '−' : pct > 0 ? '+' : '';
  return ` (${sign}${Math.abs(pct)} %)`;
}

export function buildMessage(input: MessageInput): string {
  const lines = [basename(input.path)];
  if (input.beforeBytes !== null && input.afterBytes !== null) {
    lines.push(
      `${input.outcome} · ${formatPair(input.beforeBytes, input.afterBytes)}${formatChange(input.beforeBytes, input.afterBytes)}`,
    );
  } else {
    lines.push(input.outcome);
  }
  if (input.problems.length > 0) lines.push('Problems:', ...input.problems);
  if (input.reason !== null && input.reason !== '') lines.push(`Reason: ${input.reason}`);
  return truncateBytes(lines.join('\n'), MAX_MESSAGE_BYTES);
}

/** At most `max` UTF-8 bytes; when it cuts, it cuts between characters and ends with `…`. */
export function truncateBytes(text: string, max: number): string {
  if (Buffer.byteLength(text) <= max) return text;
  const ellipsis = '…';
  const budget = max - Buffer.byteLength(ellipsis);
  let out = '';
  let used = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch);
    if (used + size > budget) break;
    out += ch;
    used += size;
  }
  return out + ellipsis;
}

export const MAX_TITLE_CHARS = 250;

/** At most `max` characters (code points, never splitting a surrogate pair); ends with `…` when it cuts. */
export function truncateChars(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

export function renderTitle(
  template: string,
  vars: { workflow: string; file: string; outcome: string },
): string {
  return truncateChars(
    template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
      key === 'workflow' || key === 'file' || key === 'outcome' ? vars[key] : whole,
    ),
    MAX_TITLE_CHARS,
  );
}
