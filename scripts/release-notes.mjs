// Prints the release-note section for one plugin from .changes/<plugin>/*.md (and the flat
// .changes/<plugin>-*.md), grouped Breaking / New / Improved / Fixed. Prints nothing when the
// plugin has no notes, and fails when one of its notes is invalid. Used by release.yml to build
// the GitHub release body. The note format and its parsing come from @transcoda/dev-config.
// Usage: node scripts/release-notes.mjs <plugin>       (in the repo root)
// Exports releaseNotes(root, plugin) for tests.
import { pathToFileURL } from 'node:url';
import { groupEntries, layoutOf, readNotes, renderGroups } from '@transcoda/dev-config/changes';

/** The plugin's notes as Markdown with ### headings; throws when one of them is invalid. */
export function releaseNotes(root, plugin) {
  const { notes, errors } = readNotes(root, layoutOf(root, 'plugins'), plugin);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return renderGroups(groupEntries(notes), 3);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const plugin = process.argv[2];
  if (!plugin) {
    console.error('usage: release-notes.mjs <plugin>');
    process.exit(2);
  }
  try {
    process.stdout.write(releaseNotes(process.cwd(), plugin));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
