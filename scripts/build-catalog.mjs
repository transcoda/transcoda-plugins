// Builds the catalog index (what core's catalogIndexSchema accepts) from the GitHub releases.
//   node scripts/build-catalog.mjs --out index.json            (gh api repos/$GITHUB_REPOSITORY/releases)
//   node scripts/build-catalog.mjs --from releases.json --out index.json   (a saved API response)
// buildCatalog() is pure: it takes normalised releases and never touches the network.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import semver from 'semver';

const SHA256 = /^[0-9a-f]{64}$/;

function parseBody(body) {
  const core = /Built against core `([^`\s]+)`/.exec(body ?? '')?.[1];
  const attestation = /^Attestation: (\S+)[ \t]*$/m.exec(body ?? '')?.[1];
  return { coreTested: core ? [core] : [], attestation: attestation ?? null };
}

/**
 * Release = { tag, publishedAt, prerelease, body, assets: [{ name, url, size }],
 *             manifest: { name, version, sdk, sha256, size, ... },
 *             checksum: <text of the .js.sha256 asset> }
 */
export function buildCatalog(releases, packages, now) {
  const byPlugin = new Map();
  for (const release of releases) {
    const { name, version } = release.manifest;
    const label = `${name} ${version}`;
    const file = `${name}-${version}`;
    const asset = (suffix) => release.assets.find((a) => a.name === `${file}${suffix}`);
    const bundle = asset('.js');
    const manifestAsset = asset('.manifest.json');
    if (!bundle) throw new Error(`${label}: no bundle asset`);
    if (!manifestAsset) throw new Error(`${label}: no manifest asset`);
    const signature = asset('.js.sig');
    if (!signature) throw new Error(`${label}: no signature asset`);
    if (!asset('.js.sha256')) throw new Error(`${label}: no checksum asset`);
    const checksum = /^([0-9a-f]{64})\b/.exec(release.checksum ?? '')?.[1];
    if (!checksum || !SHA256.test(release.manifest.sha256)) {
      throw new Error(`${label}: unreadable sha256`);
    }
    if (checksum !== release.manifest.sha256) {
      throw new Error(`${label}: sha256 mismatch between the manifest and the .sha256 asset`);
    }
    const { coreTested, attestation } = parseBody(release.body);
    const entry = {
      version,
      sdk: release.manifest.sdk,
      coreTested,
      url: bundle.url,
      manifestUrl: manifestAsset.url,
      signature: signature.url,
      sha256: release.manifest.sha256,
      size: release.manifest.size,
      attestation,
      releasedAt: new Date(release.publishedAt).toISOString(),
    };
    const prerelease = release.prerelease || semver.prerelease(version) !== null;
    const list = byPlugin.get(name) ?? [];
    list.push({ entry, prerelease });
    byPlugin.set(name, list);
  }
  const plugins = [];
  for (const name of [...byPlugin.keys()].sort()) {
    const meta = packages.get(name);
    if (!meta) throw new Error(`${name}: no plugins/${name}/package.json`);
    const list = byPlugin
      .get(name)
      .sort((a, b) => semver.rcompare(a.entry.version, b.entry.version));
    const stable = list.find((v) => !v.prerelease);
    if (!stable) continue;
    plugins.push({
      name,
      title: meta.title,
      description: meta.description,
      latest: stable.entry.version,
      versions: list.map((v) => v.entry),
    });
  }
  return { schema: 1, generated: now.toISOString(), plugins };
}

export function readPackages(root) {
  const packages = new Map();
  const dir = join(root, 'plugins');
  if (!existsSync(dir)) return packages;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name, 'package.json');
    if (!existsSync(path)) continue;
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    packages.set(name, { title: pkg.transcoda?.title ?? '', description: pkg.description ?? '' });
  }
  return packages;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res.text();
}

async function normalise(raw, fromDump) {
  const assets = raw.assets.map((a) => ({
    name: a.name,
    url: a.browser_download_url,
    size: a.size,
  }));
  const manifestAsset = assets.find((a) => a.name.endsWith('.manifest.json'));
  const checksumAsset = assets.find((a) => a.name.endsWith('.js.sha256'));
  if (!manifestAsset) throw new Error(`${raw.tag_name}: no manifest asset`);
  if (!checksumAsset) throw new Error(`${raw.tag_name}: no checksum asset`);
  return {
    tag: raw.tag_name,
    publishedAt: raw.published_at,
    prerelease: raw.prerelease,
    body: raw.body ?? '',
    assets,
    // Inline manifest/checksum are honoured only for a saved dump (--from, test input);
    // a live GitHub response is never trusted to carry them.
    manifest: (fromDump && raw.manifest) || JSON.parse(await download(manifestAsset.url)),
    checksum: (fromDump && raw.checksum) || (await download(checksumAsset.url)),
  };
}

function flatten(dump) {
  // `gh api --paginate --slurp` gives an array of pages; a plain dump is an array of releases.
  return dump.flatMap((item) => (Array.isArray(item) ? item : [item]));
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument '${a}'`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${a} needs a value`);
    flags[a.slice(2)] = value;
  }
  return flags;
}

async function main(argv) {
  const flags = parseArgs(argv);
  if (!flags.out) throw new Error('usage: build-catalog.mjs --out <file> [--from <releases.json>]');
  const root = fileURLToPath(new URL('..', import.meta.url));
  let dump;
  if (flags.from) dump = JSON.parse(readFileSync(flags.from, 'utf8'));
  else {
    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo) throw new Error('GITHUB_REPOSITORY is not set (or pass --from)');
    dump = JSON.parse(
      execFileSync('gh', ['api', `repos/${repo}/releases`, '--paginate', '--slurp'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
  }
  const releases = [];
  for (const raw of flatten(dump)) {
    if (raw.draft) continue;
    releases.push(await normalise(raw, Boolean(flags.from)));
  }
  const index = buildCatalog(releases, readPackages(root), new Date());
  writeFileSync(flags.out, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`${flags.out}: ${index.plugins.length} plugins`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`build-catalog: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
