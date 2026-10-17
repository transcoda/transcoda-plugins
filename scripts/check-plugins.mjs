// Validates every plugins/<name>/package.json:
// - name is @transcoda/plugin-<name> (the directory name is the release tag prefix);
// - version is plain semver (tags are <name>-v<version>);
// - `transcoda.sdk` declares the supported SDK range;
// - no runtime `dependencies` (bundles inline everything; plugins are never npm-installed);
// - no install scripts.
// Exports checkPlugins(root) for tests; the CLI runs only when executed directly.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];

export function checkPlugins(root) {
  const errors = [];
  const pluginsDir = join(root, 'plugins');
  if (!existsSync(pluginsDir)) return errors;
  for (const name of readdirSync(pluginsDir)) {
    const pkgPath = join(pluginsDir, name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const at = `plugins/${name}`;
    if (!/^[a-z][a-z0-9-]*$/.test(name)) errors.push(`${at}: directory name must be kebab-case`);
    if (pkg.name !== `@transcoda/plugin-${name}`) {
      errors.push(`${at}: name must be @transcoda/plugin-${name}`);
    }
    if (!SEMVER.test(pkg.version ?? '')) errors.push(`${at}: version must be semver`);
    if (typeof pkg.transcoda?.sdk !== 'string') errors.push(`${at}: missing transcoda.sdk range`);
    if (Object.keys(pkg.dependencies ?? {}).length > 0) {
      errors.push(`${at}: runtime dependencies are not allowed; use devDependencies`);
    }
    for (const script of INSTALL_SCRIPTS) {
      if (pkg.scripts?.[script]) errors.push(`${at}: install script '${script}' is not allowed`);
    }
    if (!pkg.scripts?.bundle) errors.push(`${at}: missing bundle script`);
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const errors = checkPlugins(root);
  for (const e of errors) console.error(`check-plugins: ${e}`);
  process.exit(errors.length > 0 ? 1 : 0);
}
