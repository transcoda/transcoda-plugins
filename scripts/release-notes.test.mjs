import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { releaseNotes } from './release-notes.mjs';

function root(files) {
  const dir = mkdtempSync(join(tmpdir(), 'notes-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}
const note = (type, body) => `---\ntype: ${type}\n---\n${body}\n`;

test('groups one plugin notes by type and ignores other plugins and the README', () => {
  const dir = root({
    '.changes/README.md': '# x',
    '.changes/sonarr/a.md': note('fixed', 'Fixed a thing.'),
    '.changes/sonarr/b.md': note('new', 'Added a thing.\nOn two lines.'),
    '.changes/sonarr-c.md': note('improved', 'Flat form works.'),
    '.changes/radarr/a.md': note('new', 'Not for sonarr.'),
  });
  assert.equal(
    releaseNotes(dir, 'sonarr'),
    '### New\n\n- Added a thing. On two lines.\n\n### Improved\n\n- Flat form works.\n\n### Fixed\n\n- Fixed a thing.\n',
  );
});

test('no notes gives an empty string', () => {
  assert.equal(releaseNotes(root({}), 'sonarr'), '');
  assert.equal(releaseNotes(root({ '.changes/radarr/a.md': note('new', 'x') }), 'sonarr'), '');
});
