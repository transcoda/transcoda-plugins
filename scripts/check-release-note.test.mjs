import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-release-note.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A temp repo with `plugins/sonarr` committed, then a second commit adding `files`. */
function repo(files) {
  const cwd = mkdtempSync(join(tmpdir(), 'release-note-'));
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.email', 't@example.com');
  git(cwd, 'config', 'user.name', 't');
  git(cwd, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(cwd, 'plugins', 'sonarr'), { recursive: true });
  writeFileSync(join(cwd, 'plugins', 'sonarr', 'package.json'), '{}');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', 'base');
  const base = git(cwd, 'rev-parse', 'HEAD');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', 'change');
  return { cwd, base, head: git(cwd, 'rev-parse', 'HEAD') };
}
const note = (type = 'improved', body = 'Sonarr now verifies the path.') =>
  `---\ntype: ${type}\n---\n${body}\n`;
const run = (cwd, ...args) =>
  spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });

test('a note under .changes/<plugin>/ passes', () => {
  const { cwd, base, head } = repo({ '.changes/sonarr/verify.md': note() });
  const r = run(cwd, base, head, '[]');
  assert.equal(r.status, 0, r.stderr);
});

test("main's flat .changes/<plugin>-<name>.md convention still passes", () => {
  const { cwd, base, head } = repo({ '.changes/sonarr-verify.md': note('fixed') });
  const r = run(cwd, base, head, '[]');
  assert.equal(r.status, 0, r.stderr);
});

test('a note outside a plugin folder fails', () => {
  const { cwd, base, head } = repo({ '.changes/x.md': note() });
  const r = run(cwd, base, head, '[]');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must be \.changes\/<plugin>\//);
});

test('a note for a plugin that does not exist fails', () => {
  const { cwd, base, head } = repo({ '.changes/nope/x.md': note() });
  const r = run(cwd, base, head, '[]');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no plugins\/nope/);
});

test('no note fails, the label passes', () => {
  const { cwd, base, head } = repo({ 'README.md': 'x' });
  assert.equal(run(cwd, base, head, '[]').status, 1);
  assert.equal(run(cwd, base, head, '["no user-facing change"]').status, 0);
});

test('a bad type or an empty body fails', () => {
  const bad = repo({ '.changes/sonarr/a.md': note('cool') });
  const r = run(bad.cwd, bad.base, bad.head, '[]');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /type/);
  const empty = repo({ '.changes/sonarr/a.md': note('new', '') });
  const e = run(empty.cwd, empty.base, empty.head, '[]');
  assert.equal(e.status, 1);
  assert.match(e.stderr, /empty/);
});

test('--lint validates every existing note and ignores the README', () => {
  const ok = repo({ '.changes/README.md': '# x', '.changes/sonarr/a.md': note() });
  assert.equal(run(ok.cwd, '--lint').status, 0);
  const bad = repo({ '.changes/sonarr/a.md': note('nope') });
  assert.equal(run(bad.cwd, '--lint').status, 1);
});

test('--lint and the PR check both reject a note nested deeper than .changes/<plugin>/', () => {
  const { cwd, base, head } = repo({ '.changes/sonarr/sub/deep.md': note() });
  const lint = run(cwd, '--lint');
  assert.equal(lint.status, 1, lint.stderr);
  assert.match(lint.stderr, /deep\.md/);
  const pr = run(cwd, base, head, '[]');
  assert.equal(pr.status, 1);
  assert.match(pr.stderr, /deep\.md/);
});

test('.changes/<plugin>/README.md is not a note for --lint or the PR check', () => {
  const { cwd, base, head } = repo({ '.changes/sonarr/README.md': '# not a note' });
  assert.equal(run(cwd, '--lint').status, 0);
  const pr = run(cwd, base, head, '[]');
  assert.equal(pr.status, 1);
  assert.match(pr.stderr, /No release note found/);
});

test('a Dependabot pull request needs no note', () => {
  const { cwd, base, head } = repo({ 'README.md': 'x' });
  const r = run(cwd, base, head, '[]', 'dependabot[bot]');
  assert.equal(r.status, 0, r.stderr);
});

test('another author without a note still fails', () => {
  const { cwd, base, head } = repo({ 'README.md': 'x' });
  assert.equal(run(cwd, base, head, '[]', 'someone').status, 1);
});
