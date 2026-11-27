import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { it } from 'node:test';
import { releaseNotes } from './release-notes.mjs';

function root(files) {
  const dir = mkdtempSync(join(tmpdir(), 'notes-'));
  for (const plugin of ['sonarr', 'radarr'])
    mkdirSync(join(dir, 'plugins', plugin), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}
const note = (type, body) => `---\ntype: ${type}\n---\n${body}\n`;

it('groups one plugin notes by type and ignores other plugins and the README', () => {
  const dir = root({
    '.changes/README.md': '# x',
    '.changes/sonarr/a.md': note('fixed', 'Fixed a thing.'),
    '.changes/sonarr/b.md': note('new', 'Added a thing.\nOn two lines.'),
    '.changes/sonarr-c.md': note('improved', 'Flat form works.'),
    '.changes/sonarr/d.md': note('breaking', 'Changed a thing.'),
    '.changes/radarr/a.md': note('new', 'Not for sonarr.'),
    '.changes/radarr/broken.md': 'Not for sonarr, and not read.',
  });
  assert.equal(
    releaseNotes(dir, 'sonarr'),
    '### Breaking\n\n- Changed a thing.\n\n### New\n\n- Added a thing. On two lines.\n\n### Improved\n\n- Flat form works.\n\n### Fixed\n\n- Fixed a thing.\n',
  );
});

it('no notes gives an empty string', () => {
  assert.equal(releaseNotes(root({}), 'sonarr'), '');
  assert.equal(releaseNotes(root({ '.changes/radarr/a.md': note('new', 'x') }), 'sonarr'), '');
});

it('an invalid note of the plugin fails instead of being left out', () => {
  const dir = root({ '.changes/sonarr/a.md': note('changed', 'Wrong type.') });
  assert.throws(() => releaseNotes(dir, 'sonarr'), /\.changes\/sonarr\/a\.md: front matter/);
});
