// Run from a plugin directory after tsdown. Verifies the bundle is self-contained
// (imports only node: built-ins, no runtime `dependencies` in package.json) and writes
// dist/<plugin>-<version>.js.sha256 in `sha256sum` format.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const dir = process.cwd();
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const file = `${basename(dir)}-${pkg.version}.js`;
const path = `dist/${file}`;
const code = readFileSync(path);

const errors = [];
if (Object.keys(pkg.dependencies ?? {}).length > 0) {
  errors.push('package.json must not have runtime `dependencies`; bundle them (devDependencies).');
}
const specifiers = [
  ...code.toString('utf8').matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g),
].map((m) => m[1]);
for (const spec of new Set(specifiers)) {
  if (!spec.startsWith('node:')) {
    errors.push(`${path} imports '${spec}'; only node: built-ins may stay external.`);
  }
}
if (errors.length > 0) {
  for (const e of errors) console.error(`finalize-bundle: ${e}`);
  process.exit(1);
}

const sha = createHash('sha256').update(code).digest('hex');
writeFileSync(`${path}.sha256`, `${sha}  ${file}\n`);
console.log(`${path} (${code.length} bytes)\nsha256 ${sha}`);
