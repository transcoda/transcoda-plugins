// Run from a plugin directory after tsdown. Verifies the bundle is self-contained
// (imports only node: built-ins, no runtime `dependencies` in package.json) and writes
// dist/<plugin>-<version>.js.sha256 in `sha256sum` format and dist/<plugin>-<version>.manifest.json
// (what the bundle announces, read by importing it in a permission-restricted child).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Import the bundle once, in a child that may read only the bundle and the script.
const absolute = resolve(path);
const script = fileURLToPath(new URL('./bundle-manifest.mjs', import.meta.url));
let announced;
try {
  announced = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${absolute}`,
        `--allow-fs-read=${script}`,
        script,
        absolute,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
} catch (e) {
  console.error(`finalize-bundle: cannot read the manifest from ${path}: ${e.stderr || e.message}`);
  process.exit(1);
}
const sdk = pkg.transcoda?.sdk;
if (announced.sdk !== sdk) {
  errors.push(`manifest sdk '${announced.sdk}' differs from package.json transcoda.sdk '${sdk}'`);
}
if (announced.name !== basename(dir)) {
  errors.push(`manifest name '${announced.name}' must be the directory name '${basename(dir)}'`);
}
if (announced.version !== pkg.version) {
  errors.push(`manifest version '${announced.version}' differs from package.json '${pkg.version}'`);
}
if (errors.length > 0) {
  for (const e of errors) console.error(`finalize-bundle: ${e}`);
  process.exit(1);
}

const sha = createHash('sha256').update(code).digest('hex');
writeFileSync(`${path}.sha256`, `${sha}  ${file}\n`);
const manifest = {
  name: announced.name,
  version: announced.version,
  sdk: announced.sdk,
  sha256: sha,
  size: code.length,
  nodes: announced.nodes,
  nodeVersions: announced.nodeVersions,
  integration: announced.integration,
  triggers: announced.triggers,
  hooks: announced.hooks,
};
writeFileSync(
  `dist/${basename(dir)}-${pkg.version}.manifest.json`,
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`${path} (${code.length} bytes)\nsha256 ${sha}`);
