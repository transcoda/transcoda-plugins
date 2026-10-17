import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
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

test('builds the index: latest, order, signature url, coreTested, attestation', () => {
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

test('a plugin with only prereleases is omitted', () => {
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

test('a release without a signature asset fails the build', () => {
  assert.throws(
    () => buildCatalog([release('demo', '1.0.0', { sig: false })], packages, now),
    /demo 1\.0\.0: no signature asset/,
  );
});

test('a manifest sha256 that differs from the .sha256 asset fails the build', () => {
  const r = release('demo', '1.0.0');
  r.checksum = `${HEX('b')}  demo-1.0.0.js\n`;
  assert.throws(() => buildCatalog([r], packages, now), /demo 1\.0\.0: sha256 mismatch/);
});

test('a plugin without package metadata fails the build', () => {
  assert.throws(
    () => buildCatalog([release('ghost', '1.0.0')], packages, now),
    /ghost: no plugins\/ghost\/package.json/,
  );
});

test('cli: --from reads a GitHub releases dump (slurped pages) and writes the index', () => {
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
