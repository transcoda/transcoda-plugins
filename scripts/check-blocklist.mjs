// Validates catalog/blocklist.json with the same rules as core's BlocklistEntrySchema.
//   node scripts/check-blocklist.mjs [file]      exit 1, one line per problem
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import semver from 'semver';

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const isoOk = (v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));

const DOC_KEYS = ['schema', 'generated', 'entries'];
const ENTRY_KEYS = ['id', 'sha256', 'name', 'versions', 'reason', 'url', 'added'];

function unknownKeys(obj, allowed, at, problems) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) problems.push(`${at}unknown key '${k}'`);
  }
}

export function checkBlocklist(doc) {
  const problems = [];
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return ['not a JSON object'];
  unknownKeys(doc, DOC_KEYS, '', problems);
  if (doc.schema !== 1) problems.push('schema must be 1');
  if (!isoOk(doc.generated)) problems.push('generated must be an ISO UTC datetime');
  if (!Array.isArray(doc.entries)) return [...problems, 'entries must be an array'];
  const ids = new Set();
  doc.entries.forEach((e, i) => {
    const at = `entries[${i}]`;
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      problems.push(`${at}: not an object`);
      return;
    }
    unknownKeys(e, ENTRY_KEYS, `${at}: `, problems);
    if (typeof e.id !== 'string' || e.id.length < 1 || e.id.length > 64) {
      problems.push(`${at}: id must be 1-64 characters`);
    } else if (ids.has(e.id)) problems.push(`${at}: duplicate id '${e.id}'`);
    else ids.add(e.id);
    if (e.sha256 !== undefined && !(typeof e.sha256 === 'string' && HEX64.test(e.sha256))) {
      problems.push(`${at}: sha256 must be 64 lowercase hex characters`);
    }
    if (e.name !== undefined && !(typeof e.name === 'string' && NAME.test(e.name))) {
      problems.push(`${at}: name must match ${NAME}`);
    }
    if (e.sha256 === undefined && e.name === undefined) {
      problems.push(`${at}: needs sha256 or name`);
    }
    if (e.versions !== undefined) {
      if (e.name === undefined) problems.push(`${at}: versions is only allowed together with name`);
      if (
        typeof e.versions !== 'string' ||
        e.versions.trim() === '' ||
        semver.validRange(e.versions) === null
      ) {
        problems.push(`${at}: versions '${e.versions}' is not a valid semver range`);
      }
    }
    if (
      typeof e.reason !== 'string' ||
      e.reason.trim().length < 1 ||
      e.reason.trim().length > 200
    ) {
      problems.push(`${at}: reason must be 1-200 characters after trimming`);
    }
    if (e.url !== undefined && e.url !== null) {
      if (typeof e.url !== 'string' || !e.url.startsWith('https://') || !URL.canParse(e.url)) {
        problems.push(`${at}: url must be an https url or null`);
      }
    }
    if (!isoOk(e.added)) problems.push(`${at}: added must be an ISO UTC datetime`);
    else if (isoOk(doc.generated) && Date.parse(e.added) > Date.parse(doc.generated)) {
      problems.push(`${at}: added is later than generated`);
    }
  });
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file =
    process.argv[2] ?? fileURLToPath(new URL('../catalog/blocklist.json', import.meta.url));
  let problems;
  try {
    problems = checkBlocklist(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    problems = [`cannot read ${file}: ${e instanceof Error ? e.message : e}`];
  }
  for (const p of problems) console.error(`check-blocklist: ${p}`);
  process.exit(problems.length > 0 ? 1 : 0);
}
