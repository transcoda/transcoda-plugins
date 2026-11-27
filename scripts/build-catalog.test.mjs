import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import fc from 'fast-check';
import semver from 'semver';
import { configureFastCheck } from '../test/fast-check.mjs';
import { buildCatalog } from './build-catalog.mjs';

const BASE = 'https://github.com/transcoda/transcoda-plugins/releases/download';
const HEX = (c) => c.repeat(64);

function release(name, version, { prerelease = false, body, sig = true, sha = HEX('a') } = {}) {
  const tag = `${name}-v${version}`;
  const file = `${name}-${version}`;
  const asset = (n, size = 10) => ({ name: n, url: `${BASE}/${tag}/${n}`, size });
  const assets = [
    asset(`${file}.js`, 1234),
    asset(`${file}.js.sha256`),
    asset(`${file}.manifest.json`),
  ];
  if (sig) assets.push(asset(`${file}.js.sig`));
  return {
    tag,
    publishedAt: '2026-10-01T12:00:00Z',
    prerelease,
    body: body ?? 'Built against core `m3-plugins`.',
    assets,
    checksum: `${sha}  ${file}.js\n`,
    manifest: {
      name,
      version,
      sdk: '^1',
      sha256: sha,
      size: 1234,
      nodes: [],
      integration: null,
      triggers: [],
      hooks: [],
    },
  };
}

const packages = new Map([
  ['demo', { title: 'Demo', description: 'The demo plugin.' }],
  ['other', { title: 'Other', description: 'Another one.' }],
]);
const now = new Date('2026-10-17T08:00:00Z');

it('builds the index: latest, order, signature url, coreTested, attestation', () => {
  const index = buildCatalog(
    [
      release('demo', '1.1.0-beta.1', { prerelease: true }),
      release('demo', '1.0.0'),
      release('other', '2.0.0', {
        body: `Built against core \`v1.2.0\`\nAttestation: https://github.com/transcoda/transcoda-plugins/attestations/1`,
      }),
    ],
    packages,
    now,
  );
  assert.equal(index.schema, 1);
  assert.equal(index.generated, '2026-10-17T08:00:00.000Z');
  assert.deepEqual(
    index.plugins.map((p) => p.name),
    ['demo', 'other'],
  );
  const demo = index.plugins[0];
  assert.equal(demo.title, 'Demo');
  assert.equal(demo.description, 'The demo plugin.');
  assert.equal(demo.latest, '1.0.0');
  assert.deepEqual(
    demo.versions.map((v) => v.version),
    ['1.1.0-beta.1', '1.0.0'],
  );
  assert.deepEqual(demo.versions[1], {
    version: '1.0.0',
    sdk: '^1',
    coreTested: ['m3-plugins'],
    url: `${BASE}/demo-v1.0.0/demo-1.0.0.js`,
    manifestUrl: `${BASE}/demo-v1.0.0/demo-1.0.0.manifest.json`,
    signature: `${BASE}/demo-v1.0.0/demo-1.0.0.js.sig`,
    sha256: HEX('a'),
    size: 1234,
    attestation: null,
    releasedAt: '2026-10-01T12:00:00.000Z',
  });
  const other = index.plugins[1].versions[0];
  assert.deepEqual(other.coreTested, ['v1.2.0']);
  assert.equal(other.attestation, 'https://github.com/transcoda/transcoda-plugins/attestations/1');
});

it("copies a manifest's network list into its version; a manifest without one adds none", () => {
  const listed = release('demo', '1.1.0');
  const network = [{ origin: 'https://discord.com' }, { setting: 'url', label: 'Demo URL' }];
  listed.manifest.network = network;
  const empty = release('other', '2.0.0');
  empty.manifest.network = [];
  const index = buildCatalog([listed, release('demo', '1.0.0'), empty], packages, now);
  const [demo, other] = index.plugins;
  assert.deepEqual(demo.versions[0].network, network);
  assert.equal('network' in demo.versions[1], false);
  assert.deepEqual(other.versions[0].network, []);
});

it('a manifest whose network is not a list fails the build', () => {
  const bad = release('demo', '1.0.0');
  bad.manifest.network = 'https://discord.com';
  assert.throws(() => buildCatalog([bad], packages, now), /demo 1\.0\.0: manifest network/);
});

it('a plugin with only prereleases is omitted', () => {
  const index = buildCatalog(
    [release('demo', '1.0.0-rc.1', { prerelease: true }), release('other', '2.0.0')],
    packages,
    now,
  );
  assert.deepEqual(
    index.plugins.map((p) => p.name),
    ['other'],
  );
});

it('a release without a signature asset fails the build', () => {
  assert.throws(
    () => buildCatalog([release('demo', '1.0.0', { sig: false })], packages, now),
    /demo 1\.0\.0: no signature asset/,
  );
});

it('a manifest sha256 that differs from the .sha256 asset fails the build', () => {
  const r = release('demo', '1.0.0');
  r.checksum = `${HEX('b')}  demo-1.0.0.js\n`;
  assert.throws(() => buildCatalog([r], packages, now), /demo 1\.0\.0: sha256 mismatch/);
});

it('a plugin without package metadata fails the build', () => {
  assert.throws(
    () => buildCatalog([release('ghost', '1.0.0')], packages, now),
    /ghost: no plugins\/ghost\/package.json/,
  );
});

it('cli: --from reads a GitHub releases dump (slurped pages) and writes the index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'build-catalog-'));
  try {
    const r = release('example', '1.0.0');
    const raw = {
      tag_name: r.tag,
      published_at: r.publishedAt,
      prerelease: false,
      draft: false,
      body: r.body,
      assets: r.assets.map((a) => ({ name: a.name, browser_download_url: a.url, size: a.size })),
      // test-only: skips the network download of the manifest and checksum assets
      manifest: r.manifest,
      checksum: r.checksum,
    };
    const from = join(dir, 'releases.json');
    const out = join(dir, 'index.json');
    writeFileSync(from, JSON.stringify([[raw], []]));
    execFileSync(process.execPath, ['scripts/build-catalog.mjs', '--from', from, '--out', out], {
      encoding: 'utf8',
    });
    const index = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(index.plugins[0].name, 'example');
    assert.equal(index.plugins[0].title, 'Example');
    assert.match(index.plugins[0].versions[0].signature, /example-1\.0\.0\.js\.sig$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

configureFastCheck();

it('property: each plugin lists every version newest first; latest is the newest stable one', () => {
  const version = fc
    .tuple(
      fc.nat(3),
      fc.nat(3),
      fc.nat(3),
      fc.option(fc.constantFrom('alpha.1', 'beta.1', 'beta.2', 'rc.1'), { nil: null }),
    )
    .map(([a, b, c, pre]) => `${a}.${b}.${c}${pre ? `-${pre}` : ''}`);
  const releases = fc.uniqueArray(
    fc.tuple(fc.constantFrom('demo', 'other'), version, fc.boolean()),
    {
      selector: ([name, v]) => `${name}-${v}`,
      maxLength: 12,
    },
  );
  fc.assert(
    fc.property(releases, (list) => {
      const index = buildCatalog(
        list.map(([name, v, flagged]) => release(name, v, { prerelease: flagged })),
        packages,
        now,
      );
      const names = index.plugins.map((p) => p.name);
      assert.deepEqual(names, [...names].sort());
      for (const name of ['demo', 'other']) {
        const mine = list.filter(([n]) => n === name);
        const stable = mine.filter(([, v, flagged]) => !flagged && semver.prerelease(v) === null);
        const plugin = index.plugins.find((p) => p.name === name);
        if (stable.length === 0) {
          assert.equal(plugin, undefined);
          continue;
        }
        assert.ok(plugin);
        const versions = plugin.versions.map((v) => v.version);
        assert.deepEqual(versions, mine.map(([, v]) => v).sort(semver.rcompare));
        assert.equal(plugin.latest, stable.map(([, v]) => v).sort(semver.rcompare)[0]);
      }
    }),
  );
});

it('property: the attestation line is read only as a whole line of its own', () => {
  const url = fc.webUrl().filter((u) => !/\s/.test(u));
  const noise = fc.string().map((s) => s.replace(/Attestation: /g, ''));
  fc.assert(
    fc.property(url, noise, noise, fc.constantFrom('', ' ', '\t'), (u, before, after, pad) => {
      const body = `${before}\nAttestation: ${u}${pad}\n${after}`;
      const [version] = buildCatalog([release('demo', '1.0.0', { body })], packages, now).plugins[0]
        .versions;
      assert.equal(version.attestation, u);
      const inline = buildCatalog(
        [release('demo', '1.0.0', { body: `x Attestation: ${u}` })],
        packages,
        now,
      );
      assert.equal(inline.plugins[0].versions[0].attestation, null);
    }),
  );
});
