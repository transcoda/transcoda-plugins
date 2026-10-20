// Prints the release-note section for one plugin from .changes/<plugin>/*.md (and the flat
// .changes/<plugin>-*.md), grouped New / Improved / Fixed / Breaking. Prints nothing when the
// plugin has no notes. Used by release.yml to build the GitHub release body.
// Usage: node scripts/release-notes.mjs <plugin>       (in the repo root)
// Exports releaseNotes(root, plugin) for tests.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const GROUPS = [
  ['breaking', 'Breaking'],
  ['new', 'New'],
  ['improved', 'Improved'],
  ['fixed', 'Fixed'],
];

export function releaseNotes(root, plugin) {
  const dir = join(root, '.changes');
  if (!existsSync(dir)) return '';
  const files = [];
  const nested = join(dir, plugin);
  if (existsSync(nested)) {
    for (const f of readdirSync(nested)) if (f.endsWith('.md')) files.push(join(nested, f));
  }
  for (const f of readdirSync(dir)) {
    if (f.startsWith(`${plugin}-`) && f.endsWith('.md')) files.push(join(dir, f));
  }
  const byType = new Map();
  for (const file of files.sort()) {
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(file, 'utf8'));
    const type = match ? /^type:\s*(\S+)\s*$/m.exec(match[1])?.[1] : undefined;
    const body = match?.[2].trim().replace(/\s*\n\s*/g, ' ');
    if (!type || !body) continue;
    byType.set(type, [...(byType.get(type) ?? []), body]);
  }
  return GROUPS.filter(([type]) => byType.has(type))
    .map(
      ([type, title]) =>
        `### ${title}\n\n${byType
          .get(type)
          .map((b) => `- ${b}`)
          .join('\n')}\n`,
    )
    .join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const plugin = process.argv[2];
  if (!plugin) {
    console.error('usage: release-notes.mjs <plugin>');
    process.exit(2);
  }
  process.stdout.write(releaseNotes(process.cwd(), plugin));
}
