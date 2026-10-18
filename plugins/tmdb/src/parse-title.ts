export interface ParsedTitle {
  title: string;
  year: number | null;
  kind: 'movie' | 'tv' | 'unknown';
}

const VIDEO_EXTENSION = /\.(?:mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|mts|mpg|mpeg|webm|flv|iso)$/i;
// Words that also occur in real titles ("Dark Web"): they only end a title after a year.
const WEAK_TOKENS = new Set(['web', 'dv', 'avc', 'hdr', 'internal', 'proper', 'repack']);
const RELEASE_TOKENS = [
  '2160p',
  '1080p',
  '720p',
  '480p',
  'WEB-DL',
  'WEBDL',
  'WEBRip',
  'WEB',
  'BluRay',
  'BDRip',
  'BRRip',
  'HDTV',
  'REMUX',
  'x264',
  'x265',
  'h264',
  'h265',
  'HEVC',
  'AVC',
  'AAC',
  'AC3',
  'DDP',
  'DTS',
  'TrueHD',
  'Atmos',
  'HDR',
  'DV',
  '10bit',
  'PROPER',
  'REPACK',
  'INTERNAL',
];
const RELEASE_RE = new RegExp(`\\b(?:${RELEASE_TOKENS.join('|')})\\b`, 'i');
const TV_MARKERS = [/\bS\d{1,2}E\d{1,3}\b/i, /\b\d{1,2}x\d{2}\b/];
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;
const SEASON_FOLDER = /^(?:season|series|staffel|specials?)\b|^s\d{1,2}$/i;

// Abbreviations whose period belongs to the title (`Sherlock Jr.`, `Mr. Robot`).
const ABBREVIATION_DOT = /\b(Jr|Sr|Dr|Mr|Mrs|Ms|St|Mt|Vs|Vol)\.(?=[\s()[\]{}]|$)/gi;
const KEPT_DOT = '\u0000';

function tidy(text: string): string {
  // Only a name written with spaces uses `.` as punctuation; in a release name dots separate words.
  const kept = /\s/.test(text) ? text.replace(ABBREVIATION_DOT, `$1${KEPT_DOT}`) : text;
  return kept
    .replace(/[._]/g, ' ')
    .replaceAll(KEPT_DOT, '.')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimSeparators(text: string): string {
  return text.replace(/^[\s\-–—:,]+|[\s\-–—:,]+$/g, '').replace(/\s+/g, ' ');
}

function clean(name: string): string {
  return tidy(name.replace(VIDEO_EXTENSION, '')).replace(/\b((?:19|20)\d{2})-[A-Za-z0-9]+$/, '$1');
}

/** Index where the release junk starts (not at the very start), or Infinity. */
function releaseCut(text: string): number {
  const firstYear =
    [...text.matchAll(YEAR_RE)].find((m) => m.index > 0)?.index ?? Number.POSITIVE_INFINITY;
  const re = new RegExp(RELEASE_RE.source, 'gi');
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index === 0) continue;
    if (!WEAK_TOKENS.has(m[0].toLowerCase()) || m.index > firstYear) return m.index;
  }
  return Number.POSITIVE_INFINITY;
}

function yearAndTitle(text: string, limit: number): { title: string; year: number | null } {
  const years = [...text.matchAll(YEAR_RE)].filter((m) => m.index > 0);
  const before = years.filter((m) => m.index < limit);
  const chosen = before.length > 0 ? before[before.length - 1] : years[0];
  if (chosen === undefined) return { title: trimSeparators(text.slice(0, limit)), year: null };
  return {
    title: trimSeparators(text.slice(0, Math.min(chosen.index, limit))),
    year: Number(chosen[0]),
  };
}

/** The show folder of an episode's directory: the last segment that is not a season folder. */
function showFolder(folderName: string): string {
  const segments = folderName.split('/').filter((s) => s !== '');
  while (segments.length > 0 && SEASON_FOLDER.test(segments[segments.length - 1] ?? '')) {
    segments.pop();
  }
  return segments[segments.length - 1] ?? '';
}

/** Guess title, year and kind from a file name; for episodes without a title, from the folder. */
export function parseTitle(fileName: string, folderName: string): ParsedTitle {
  const text = clean(fileName);
  const cut = releaseCut(text);
  let marker = -1;
  for (const re of TV_MARKERS) {
    const m = re.exec(text);
    if (m !== null && (marker === -1 || m.index < marker)) marker = m.index;
  }
  if (marker !== -1) {
    const head = yearAndTitle(text.slice(0, Math.min(marker, cut)), Number.POSITIVE_INFINITY);
    // "Show 2019 S01E01": the year sits right before the marker and is not part of the title.
    let { title, year } = head;
    if (title.length < 2) {
      const folder = yearAndTitle(clean(showFolder(folderName)), Number.POSITIVE_INFINITY);
      title = folder.title;
      year = folder.year ?? year;
    }
    return { title, year, kind: 'tv' };
  }
  const { title, year } = yearAndTitle(text, cut);
  if (year !== null) return { title, year, kind: 'movie' };
  // A name without a year: the movie's own folder ("Drift (2019)") may carry it.
  const folder = clean(
    folderName
      .split('/')
      .filter((s) => s !== '')
      .pop() ?? '',
  );
  const fromFolder = yearAndTitle(folder, releaseCut(folder));
  if (fromFolder.year !== null && fromFolder.title !== '') {
    return { ...fromFolder, kind: 'movie' };
  }
  return { title, year: null, kind: 'unknown' };
}
