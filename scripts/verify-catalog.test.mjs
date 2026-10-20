import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { publicKeyHex, signFile } from './sign.mjs';
import { verifyCatalog } from './verify-catalog.mjs';

const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
const pub = publicKeyHex(pem);
const bytes = Buffer.from('console.log(1)');
const sha = createHash('sha256').update(bytes).digest('hex');
const index = (over = {}) => ({
  plugins: [
    {
      name: 'demo',
      versions: [
        {
          version: '1.0.0',
          url: 'https://x/b.js',
          signature: 'https://x/b.js.sig',
          sha256: sha,
          ...over,
        },
      ],
    },
  ],
});
const serve = (files) => async (url) =>
  files[url] === undefined
    ? { ok: false, status: 404 }
    : { ok: true, arrayBuffer: async () => Buffer.from(files[url]) };

test('good bundle and signature pass', async () => {
  const f = serve({ 'https://x/b.js': bytes, 'https://x/b.js.sig': signFile(bytes, pem, 'k1') });
  assert.deepEqual(await verifyCatalog(index(), pub, f), []);
});

test('sha mismatch, bad signature and a missing signature each fail', async () => {
  const sig = signFile(bytes, pem, 'k1');
  assert.match(
    (
      await verifyCatalog(
        index({ sha256: 'a'.repeat(64) }),
        pub,
        serve({ 'https://x/b.js': bytes, 'https://x/b.js.sig': sig }),
      )
    )[0],
    /demo 1\.0\.0: bundle sha256/,
  );
  const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.match(
    (
      await verifyCatalog(
        index(),
        pub,
        serve({ 'https://x/b.js': bytes, 'https://x/b.js.sig': signFile(bytes, other, 'k2') }),
      )
    )[0],
    /signature does not match/,
  );
  assert.match(
    (await verifyCatalog(index(), pub, serve({ 'https://x/b.js': bytes })))[0],
    /HTTP 404/,
  );
});
