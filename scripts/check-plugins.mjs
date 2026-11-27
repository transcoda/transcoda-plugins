// Validates every plugins/<name>/package.json:
// - name is @transcoda/plugin-<name> (the directory name is the release tag prefix);
// - version is plain semver (tags are <name>-v<version>);
// - `transcoda.sdk` declares the supported SDK range;
// - `transcoda.title` is the display name the catalog shows;
// - no runtime `dependencies` (bundles inline everything; plugins are never npm-installed);
// - no install scripts;
// - `@transcoda/sdk` pinned to the root package.json's exact version, in every plugin and package;
// - that pin satisfies `transcoda.sdk`, and the range does not start below the SDK minor of a
//   feature the plugin's code (or a workspace package it uses) relies on (SDK_FEATURES);
// - a plugin with a secret setting (`secret()`) has src/secret-hygiene.test.ts;
// - test helpers live in src/test-util.ts in every plugin and package: no test/ directory, no
//   other helper file names, and no other non-test file imports test code (so none is bundled).
// Exports checkPlugins(root) for tests; the CLI runs only when executed directly.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import semver from 'semver';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const SDK = '@transcoda/sdk';

/**
 * SDK features added after 1.0 that a plugin can only rely on when its range starts at their minor.
 * They are fields, not exports (every 1.x has the same value exports but `pluginNetwork`), so the
 * check looks for the field in the source. Not listed: 1.2's `roots` on a test result, because the
 * word is too common to find reliably; ranges that use it need a reviewer's eye.
 */
const SDK_FEATURES = [
  { since: '1.1.0', what: 'damagedOnly (the Damaged side)', pattern: /\bdamagedOnly\s*:/ },
  { since: '1.1.0', what: "an output's shownWhen", pattern: /\bshownWhen\s*:/ },
  { since: '1.3.0', what: 'pluginNetwork', pattern: /\bpluginNetwork\b/ },
];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Non-test .ts files under `dir`, recursively. */
function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const path = join(dir, f);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return f.endsWith('.ts') && !f.endsWith('.test.ts') ? [path] : [];
  });
}

/** Source text without comments, so a comment naming a feature does not count as using it. */
function code(path) {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** packages/<dir> by package name, for following a plugin's workspace dependencies. */
function workspacePackages(root) {
  const dir = join(root, 'packages');
  const byName = new Map();
  if (!existsSync(dir)) return byName;
  for (const name of readdirSync(dir)) {
    const pkgPath = join(dir, name, 'package.json');
    if (existsSync(pkgPath)) byName.set(readJson(pkgPath).name, join(dir, name));
  }
  return byName;
}

const TEST_IMPORT =
  /from\s+['"](vitest|@transcoda\/sdk\/testing|@transcoda\/plugin-test-utils|[^'"]*\/test-util(\.ts)?)['"]/;
const HELPER_NAMES = /^(test-?support|test-?helpers?|test-?utils|testing|fixtures?)\.ts$/;
/** The one package whose own source is test code. */
const TEST_PACKAGE = '@transcoda/plugin-test-utils';

/** Layout rules for test helpers in one plugin or package directory. */
function testHelperErrors(at, dir) {
  const errors = [];
  if (existsSync(join(dir, 'test')) && readdirSync(join(dir, 'test')).length > 0) {
    errors.push(`${at}: test helpers go in src/test-util.ts, not a test/ directory`);
  }
  for (const file of sourceFiles(join(dir, 'src'))) {
    const rel = relative(dir, file);
    if (rel === join('src', 'test-util.ts')) continue;
    const base = rel.split('/').pop() ?? rel;
    if (HELPER_NAMES.test(base)) {
      errors.push(`${at}: ${rel} looks like a test helper; name it src/test-util.ts`);
    } else if (TEST_IMPORT.test(code(file))) {
      errors.push(
        `${at}: ${rel} imports test code; only *.test.ts and src/test-util.ts may (bundles must not)`,
      );
    }
  }
  return errors;
}

function sdkPin(pkg) {
  return pkg.devDependencies?.[SDK] ?? pkg.dependencies?.[SDK];
}

export function checkPlugins(root) {
  const errors = [];
  const pluginsDir = join(root, 'plugins');
  if (!existsSync(pluginsDir)) return errors;
  const rootPkgPath = join(root, 'package.json');
  const rootPin = existsSync(rootPkgPath) ? sdkPin(readJson(rootPkgPath)) : undefined;
  const packages = workspacePackages(root);
  for (const [pkgName, dir] of packages) {
    if (pkgName !== TEST_PACKAGE) errors.push(...testHelperErrors(relative(root, dir), dir));
    const pin = sdkPin(readJson(join(dir, 'package.json')));
    if (rootPin !== undefined && pin !== undefined && pin !== rootPin) {
      errors.push(`${relative(root, dir)}: pins ${SDK} ${pin}; the root pins ${rootPin}`);
    }
  }
  for (const name of readdirSync(pluginsDir)) {
    const pkgPath = join(pluginsDir, name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = readJson(pkgPath);
    const at = `plugins/${name}`;
    if (!/^[a-z][a-z0-9-]*$/.test(name)) errors.push(`${at}: directory name must be kebab-case`);
    if (pkg.name !== `@transcoda/plugin-${name}`) {
      errors.push(`${at}: name must be @transcoda/plugin-${name}`);
    }
    if (!SEMVER.test(pkg.version ?? '')) errors.push(`${at}: version must be semver`);
    if (typeof pkg.transcoda?.sdk !== 'string') errors.push(`${at}: missing transcoda.sdk range`);
    else if (semver.validRange(pkg.transcoda.sdk) === null) {
      errors.push(`${at}: transcoda.sdk '${pkg.transcoda.sdk}' is not a valid semver range`);
    }
    if (typeof pkg.transcoda?.title !== 'string' || pkg.transcoda.title.trim() === '') {
      errors.push(`${at}: missing transcoda.title`);
    }
    if (Object.keys(pkg.dependencies ?? {}).length > 0) {
      errors.push(`${at}: runtime dependencies are not allowed; use devDependencies`);
    }
    for (const script of INSTALL_SCRIPTS) {
      if (pkg.scripts?.[script]) errors.push(`${at}: install script '${script}' is not allowed`);
    }
    if (!pkg.scripts?.bundle) errors.push(`${at}: missing bundle script`);
    errors.push(...sdkErrors(at, pkg, rootPin, join(pluginsDir, name), packages));
    errors.push(...testHelperErrors(at, join(pluginsDir, name)));
    const sources = sourceFiles(join(pluginsDir, name, 'src'));
    const hasSecret = sources.some((f) => /\bsecret\(/.test(code(f)));
    if (hasSecret && !existsSync(join(pluginsDir, name, 'src', 'secret-hygiene.test.ts'))) {
      errors.push(`${at}: has a secret setting but no src/secret-hygiene.test.ts`);
    }
  }
  return errors;
}

/** The SDK pin and range rules for one plugin. */
function sdkErrors(at, pkg, rootPin, dir, packages) {
  const errors = [];
  const pin = sdkPin(pkg);
  if (pin === undefined) return [`${at}: missing the ${SDK} devDependency`];
  if (rootPin !== undefined && pin !== rootPin) {
    errors.push(`${at}: pins ${SDK} ${pin}; the root pins ${rootPin}`);
  }
  const range = pkg.transcoda?.sdk;
  if (typeof range !== 'string' || semver.validRange(range) === null) return errors;
  if (semver.valid(pin) !== null && !semver.satisfies(pin, range, { includePrerelease: true })) {
    errors.push(`${at}: transcoda.sdk '${range}' is not satisfied by the pinned ${SDK} ${pin}`);
  }
  const min = semver.minVersion(range);
  if (min === null) return errors;
  const dirs = [dir];
  for (const [dep, spec] of Object.entries(pkg.devDependencies ?? {})) {
    if (String(spec).startsWith('workspace:') && packages.has(dep)) dirs.push(packages.get(dep));
  }
  const text = dirs.flatMap((d) => sourceFiles(join(d, 'src'))).map(code);
  for (const feature of SDK_FEATURES) {
    if (semver.gte(min, feature.since)) continue;
    if (text.some((t) => feature.pattern.test(t))) {
      const minor = feature.since.replace(/\.0$/, '');
      errors.push(
        `${at}: uses ${feature.what}, new in SDK ${minor}, but transcoda.sdk '${range}' allows ${min}; use '^${minor}'`,
      );
    }
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const errors = checkPlugins(root);
  for (const e of errors) console.error(`check-plugins: ${e}`);
  process.exit(errors.length > 0 ? 1 : 0);
}
