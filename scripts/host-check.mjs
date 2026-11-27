// Runs every built plugin bundle through the core's own host: `--check-plugin` starts it in the real
// sandbox, reads what it announces and judges the sdk range against the core's SDK version
// (prereleases count, so an rc core accepts '^1'). Needs core checked out at ../transcoda; builds
// its server first unless --no-build is given. Run after `pnpm bundle`.
// Against a released core that is older than a plugin's range allows (CI's matrix runs old cores),
// that plugin is skipped, not failed: its range says it does not run there. A core newer than the
// range (an SDK major the plugin does not claim) still fails.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import semver from 'semver';

/** Default runner: the real core `--check-plugin` one-shot; returns its parsed JSON result. */
function runCore(main, bundle) {
  const run = spawnSync(process.execPath, [main, '--check-plugin', bundle], { encoding: 'utf8' });
  try {
    return JSON.parse(run.stdout.trim().split('\n').pop() ?? '');
  } catch {
    return { ok: false, error: `no result (exit ${run.status}): ${run.stderr.trim()}` };
  }
}

/** True when `coreSdk` is below every version `range` allows, so the plugin does not claim this core. */
function coreTooOld(coreSdk, range) {
  const min = semver.validRange(range) === null ? null : semver.minVersion(range);
  return coreSdk !== null && min !== null && semver.lt(coreSdk, min);
}

/**
 * Returns the failure lines (empty = all good). `check(main, bundle)` is injectable for tests.
 * `coreSdk` is the core's SDK version (null when unknown: an incompatible range then always fails).
 */
export function hostCheck(root, main, check = runCore, print = console.log, coreSdk = null) {
  const failures = [];
  const pluginsDir = join(root, 'plugins');
  const bundles = [];
  for (const name of readdirSync(pluginsDir)) {
    const dist = join(pluginsDir, name, 'dist');
    if (!existsSync(dist)) continue;
    for (const f of readdirSync(dist)) if (f.endsWith('.js')) bundles.push(join(dist, f));
  }
  if (bundles.length === 0) return ['no bundles found; run `pnpm bundle` first'];
  for (const bundle of bundles) {
    const label = bundle.slice(root.length);
    const result = check(main, bundle);
    if (result.ok !== true) {
      failures.push(`${label}: ${result.error}`);
      continue;
    }
    if (result.compatible !== true && coreTooOld(coreSdk, result.sdk)) {
      print(
        `host-check: ${label}: skipped (sdk ${result.sdk} needs a newer core than sdk ${coreSdk})`,
      );
      continue;
    }
    if (result.compatible !== true) {
      failures.push(`${label}: sdk range ${result.sdk} is not satisfied by this core`);
      continue;
    }
    const stampPath = bundle.replace(/\.js$/, '.manifest.json');
    if (!existsSync(stampPath)) {
      failures.push(`${label}: ${stampPath.slice(root.length)} is missing`);
      continue;
    }
    const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
    const differs = ['name', 'version', 'sdk'].filter((k) => stamp[k] !== result[k]);
    if (differs.length > 0) {
      failures.push(
        `${label}: core reports ${differs.map((k) => `${k} '${result[k]}'`).join(', ')}; the stamped manifest says ${differs.map((k) => `'${stamp[k]}'`).join(', ')}`,
      );
      continue;
    }
    print(`host-check: ${label}: OK (${result.name} ${result.version}, sdk ${result.sdk})`);
  }
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const core = join(root, '..', 'transcoda');
  const main = join(core, 'apps', 'server', 'dist', 'main.js');
  if (!process.argv.includes('--no-build')) {
    execFileSync('pnpm', ['--dir', core, '--filter', '@transcoda/server', 'build'], {
      stdio: 'inherit',
    });
  }
  if (!existsSync(main)) {
    console.error(`host-check: ${main} is missing; build the core server first`);
    process.exit(1);
  }
  const sdkPkg = join(core, 'packages', 'sdk', 'package.json');
  const coreSdk = existsSync(sdkPkg) ? JSON.parse(readFileSync(sdkPkg, 'utf8')).version : null;
  const failures = hostCheck(root, main, runCore, console.log, coreSdk);
  for (const f of failures) console.error(`host-check: ${f}`);
  process.exit(failures.length > 0 ? 1 : 0);
}
