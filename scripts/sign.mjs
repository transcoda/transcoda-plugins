// ed25519 signing for bundles, the catalog index and the blocklist.
//   node scripts/sign.mjs keygen --out <dir>
//   node scripts/sign.mjs sign <file> --key-id <id> [--key <pem-path>]   (key from env PLUGIN_SIGNING_KEY otherwise)
//   node scripts/sign.mjs verify <file> --public <64 hex>
// Signature file (<file>.sig): { schema: 1, alg: 'ed25519', keyId, signature: <base64 of 64 bytes> }.
// Public keys are the raw 32 bytes as 64 lowercase hex characters; the private key is PKCS8 PEM.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const SIGNATURE_B64 = /^[A-Za-z0-9+/]{86}==$/;
const HEX_KEY = /^[0-9a-f]{64}$/;

function ed25519Private(privatePem) {
  const key = createPrivateKey(privatePem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`signing key must be ed25519, got ${key.asymmetricKeyType}`);
  }
  return key;
}

export function publicKeyHex(privatePem) {
  const pub = createPublicKey(ed25519Private(privatePem));
  return pub.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
}

export function signFile(bytes, privatePem, keyId) {
  if (!KEY_ID.test(keyId))
    throw new Error(`invalid key id '${keyId}' (allowed: A-Za-z0-9._-, 1-64)`);
  const signature = sign(null, bytes, ed25519Private(privatePem)).toString('base64');
  return `${JSON.stringify({ schema: 1, alg: 'ed25519', keyId, signature })}\n`;
}

export function verifyFile(bytes, sigText, publicHex) {
  let doc;
  try {
    doc = JSON.parse(sigText);
  } catch {
    return { ok: false, reason: 'malformed signature file: not JSON' };
  }
  const malformed = (why) => ({ ok: false, reason: `malformed signature file: ${why}` });
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc))
    return malformed('not an object');
  const keys = Object.keys(doc).sort().join(',');
  if (keys !== 'alg,keyId,schema,signature') {
    return malformed('expected exactly schema, alg, keyId, signature');
  }
  if (doc.schema !== 1) return malformed('schema must be 1');
  if (doc.alg !== 'ed25519') return malformed('alg must be ed25519');
  if (typeof doc.keyId !== 'string' || !KEY_ID.test(doc.keyId)) return malformed('invalid keyId');
  if (typeof doc.signature !== 'string' || !SIGNATURE_B64.test(doc.signature)) {
    return malformed('signature must be base64 of 64 bytes');
  }
  const sig = Buffer.from(doc.signature, 'base64');
  if (!HEX_KEY.test(publicHex))
    return { ok: false, reason: 'public key must be 64 lowercase hex characters' };
  const key = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicHex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
  if (key.asymmetricKeyType !== 'ed25519')
    return { ok: false, reason: 'public key is not ed25519' };
  if (!verify(null, bytes, key, sig)) return { ok: false, reason: 'signature does not match' };
  return { ok: true, keyId: doc.keyId };
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} needs a value`);
      flags[a.slice(2)] = value;
    } else positional.push(a);
  }
  return { positional, flags };
}

function need(flags, name) {
  if (!flags[name]) throw new Error(`missing --${name}`);
  return flags[name];
}

function main(argv) {
  const [command, ...rest] = argv;
  const { positional, flags } = parseArgs(rest);
  if (command === 'keygen') {
    const out = need(flags, 'out');
    const { privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'signing-key.pem'), pem, { mode: 0o600, flag: 'wx' });
    console.log(`public-key: ${publicKeyHex(pem)}`);
    return 0;
  }
  if (command === 'sign') {
    const file = positional[0];
    if (!file) throw new Error('usage: sign <file> --key-id <id>');
    const pem = flags.key ? readFileSync(flags.key, 'utf8') : process.env.PLUGIN_SIGNING_KEY;
    if (!pem) throw new Error('no signing key: set PLUGIN_SIGNING_KEY or pass --key <pem-path>');
    const keyId = need(flags, 'key-id');
    writeFileSync(`${file}.sig`, signFile(readFileSync(file), pem, keyId));
    console.log(`signed ${file} (key ${keyId})`);
    return 0;
  }
  if (command === 'verify') {
    const file = positional[0];
    if (!file) throw new Error('usage: verify <file> --public <64 hex>');
    const publicHex = need(flags, 'public');
    let sigText;
    try {
      sigText = readFileSync(`${file}.sig`, 'utf8');
    } catch (e) {
      if (e?.code !== 'ENOENT') throw e;
      console.error('verify: signature file missing');
      return 1;
    }
    const result = verifyFile(readFileSync(file), sigText, publicHex);
    if (!result.ok) {
      console.error(`verify: ${result.reason}`);
      return 1;
    }
    console.log(`ok ${file} (key ${result.keyId})`);
    return 0;
  }
  throw new Error('usage: sign.mjs keygen|sign|verify ...');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`sign: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
