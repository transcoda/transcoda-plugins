// Release-note rules for the plugins repo (see .changes/README.md).
//   node scripts/check-release-note.mjs <base-sha> <head-sha> <labels-json>
//       a pull request must add or change a note, or carry the "no user-facing change" label
//   node scripts/check-release-note.mjs --lint
//       validates every note that exists
// A note is .changes/<plugin>/<short-name>.md, or the flat .changes/<plugin>-<short-name>.md
// (the form the GitHub templates introduced); <plugin> must be a directory under plugins/.
// Front matter `type: new|improved|fixed|breaking`, then one or two sentences.
// Runs in the current directory (a git checkout). Run by .github/workflows/release-note.yml
// and, with --lint, by `pnpm check-plugins`.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const NO_NOTE_LABEL = 'no user-facing change';
const TYPES = ['new', 'improved', 'fixed', 'breaking'];

const plugins = existsSync('plugins')
  ? readdirSync('plugins', { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  : [];

/** Problems with where a note sits, as strings; [] when the location is fine. */
function locationErrors(file) {
  const nested = /^\.changes\/([^/]+)\/[^/]+\.md$/.exec(file);
  if (nested) {
    return plugins.includes(nested[1]) ? [] : [`${file}: no plugins/${nested[1]} directory`];
  }
  const flat = /^\.changes\/([^/]+)\.md$/.exec(file);
  if (flat && plugins.some((p) => flat[1].startsWith(`${p}-`))) return [];
  return [
    `${file}: must be .changes/<plugin>/<short-name>.md (or .changes/<plugin>-<short-name>.md) where <plugin> is a directory under plugins/`,
  ];
}

function contentErrors(file) {
  const text = readFileSync(file, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  const type = match ? /^type:\s*(\S+)\s*$/m.exec(match[1])?.[1] : undefined;
  const errors = [];
  if (!type || !TYPES.includes(type)) {
    errors.push(`${file}: front matter needs "type:" set to one of ${TYPES.join(', ')}.`);
  }
  if (!match?.[2].trim()) errors.push(`${file}: the note text is empty.`);
  return errors;
}

function report(files) {
  const errors = files.flatMap((f) => {
    const where = locationErrors(f);
    return where.length > 0 ? where : contentErrors(f);
  });
  for (const e of errors) console.error(e);
  return errors.length === 0;
}

const isNote = (f) => /^\.changes\/.+\.md$/.test(f) && f !== '.changes/README.md';
const args = process.argv.slice(2);

if (args[0] === '--lint') {
  const all = [];
  if (existsSync('.changes')) {
    for (const entry of readdirSync('.changes', { withFileTypes: true })) {
      if (entry.isDirectory()) {
        for (const f of readdirSync(`.changes/${entry.name}`))
          all.push(`.changes/${entry.name}/${f}`);
      } else all.push(`.changes/${entry.name}`);
    }
  }
  process.exit(report(all.filter((f) => f.endsWith('.md') && isNote(f))) ? 0 : 1);
}

const [base, head, labelsJson = '[]'] = args;
if (!base || !head) {
  console.error('usage: check-release-note.mjs <base-sha> <head-sha> <labels-json> | --lint');
  process.exit(2);
}
if (JSON.parse(labelsJson).includes(NO_NOTE_LABEL)) {
  console.log(`Label "${NO_NOTE_LABEL}" present: no release note needed.`);
  process.exit(0);
}
const changed = execFileSync(
  'git',
  ['diff', '--name-only', '--diff-filter=AM', `${base}...${head}`],
  {
    encoding: 'utf8',
  },
)
  .split('\n')
  .filter(isNote);
if (changed.length === 0) {
  console.error(
    `No release note found. Add .changes/<plugin>/<short-name>.md (see .changes/README.md), or ask a maintainer to add the "${NO_NOTE_LABEL}" label.`,
  );
  process.exit(1);
}
if (!report(changed)) process.exit(1);
console.log(`Release note found: ${changed.join(', ')}`);
