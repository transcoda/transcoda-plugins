import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { publicKeyHex, signFile, verifyFile } from './sign.mjs';

const SCRIPT = 'scripts/sign.mjs';

function keygen(dir) {
  const out = execFileSync(process.execPath, [SCRIPT, 'keygen', '--out', dir], {
    encoding: 'utf8',
  });
  const hex = /^public-key: ([0-9a-f]{64})$/m.exec(out)?.[1];
  assert.ok(hex, 'keygen prints the public key');
  return { hex, pem: readFileSync(join(dir, 'signing-key.pem'), 'utf8'), stdout: out };
}

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'sign-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('round trip', () => {
  withTmp((dir) => {
    const { hex, pem } = keygen(dir);
    assert.match(publicKeyHex(pem), /^[0-9a-f]{64}$/);
    assert.equal(publicKeyHex(pem), hex);
    const sig = signFile(Buffer.from('hello'), pem, 'test-1');
    assert.deepEqual(verifyFile(Buffer.from('hello'), sig, hex), { ok: true, keyId: 'test-1' });
  });
});

test('tampered bytes fail', () => {
  withTmp((dir) => {
    const { hex, pem } = keygen(dir);
    const sig = signFile(Buffer.from('hello'), pem, 'test-1');
    assert.deepEqual(verifyFile(Buffer.from('hellp'), sig, hex), {
      ok: false,
      reason: 'signature does not match',
    });
  });
});

test('wrong key fails', () => {
  withTmp((dir) => {
    const a = keygen(join(dir));
    const otherDir = mkdtempSync(join(dir, 'other-'));
    const b = keygen(otherDir);
    const sig = signFile(Buffer.from('hello'), a.pem, 'test-1');
    assert.deepEqual(verifyFile(Buffer.from('hello'), sig, b.hex), {
      ok: false,
      reason: 'signature does not match',
    });
  });
});

test('malformed sig file', () => {
  const hex = 'a'.repeat(64);
  const r = verifyFile(Buffer.from('x'), '{"schema":2}', hex);
  assert.equal(r.ok, false);
  assert.match(r.reason, /^malformed signature file/);
  const notJson = verifyFile(Buffer.from('x'), 'nope', hex);
  assert.equal(notJson.ok, false);
  assert.match(notJson.reason, /^malformed signature file/);
});

test('sig file shape', () => {
  withTmp((dir) => {
    const { pem } = keygen(dir);
    const text = signFile(Buffer.from('hello'), pem, 'test-1');
    assert.ok(text.endsWith('\n'));
    const parsed = JSON.parse(text);
    assert.deepEqual(Object.keys(parsed).sort(), ['alg', 'keyId', 'schema', 'signature']);
    assert.equal(Buffer.from(parsed.signature, 'base64').length, 64);
    assert.deepEqual(parsed, {
      schema: 1,
      alg: 'ed25519',
      keyId: 'test-1',
      signature: parsed.signature,
    });
  });
});

test('keygen writes a 0600 key and never prints it', () => {
  withTmp((dir) => {
    const { stdout } = keygen(dir);
    assert.equal(statSync(join(dir, 'signing-key.pem')).mode & 0o777, 0o600);
    assert.ok(!stdout.includes('PRIVATE'));
  });
});

test('rejects a bad key id', () => {
  withTmp((dir) => {
    const { pem } = keygen(dir);
    assert.throws(() => signFile(Buffer.from('x'), pem, 'bad id!'), /key id/);
  });
});

test('cli', () => {
  withTmp((dir) => {
    const a = keygen(dir);
    const otherDir = mkdtempSync(join(dir, 'other-'));
    const b = keygen(otherDir);
    const file = join(dir, 'doc.json');
    writeFileSync(file, '{"a":1}\n');
    const keyPath = join(dir, 'signing-key.pem');
    const signed = execFileSync(
      process.execPath,
      [SCRIPT, 'sign', file, '--key-id', 'test-1', '--key', keyPath],
      { encoding: 'utf8' },
    );
    assert.equal(signed, `signed ${file} (key test-1)\n`);
    const ok = execFileSync(process.execPath, [SCRIPT, 'verify', file, '--public', a.hex], {
      encoding: 'utf8',
    });
    assert.equal(ok, `ok ${file} (key test-1)\n`);
    assert.throws(
      () =>
        execFileSync(process.execPath, [SCRIPT, 'verify', file, '--public', b.hex], {
          stdio: 'pipe',
        }),
      (e) => e.status === 1 && /verify: signature does not match/.test(String(e.stderr)),
    );
  });
});

test('cli sign reads the key from PLUGIN_SIGNING_KEY', () => {
  withTmp((dir) => {
    const a = keygen(dir);
    const file = join(dir, 'doc.json');
    writeFileSync(file, 'x');
    execFileSync(process.execPath, [SCRIPT, 'sign', file, '--key-id', 'env-1'], {
      env: { ...process.env, PLUGIN_SIGNING_KEY: a.pem },
    });
    const sig = readFileSync(`${file}.sig`, 'utf8');
    assert.deepEqual(verifyFile(Buffer.from('x'), sig, a.hex), { ok: true, keyId: 'env-1' });
  });
});

function sigWith(pem, patch) {
  const doc = { ...JSON.parse(signFile(Buffer.from('x'), pem, 'k1')), ...patch };
  for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
  return JSON.stringify(doc);
}

test('strict signature file validation', () => {
  withTmp((dir) => {
    const { hex, pem } = keygen(dir);
    const good = JSON.parse(signFile(Buffer.from('x'), pem, 'k1'));
    const bad = (patch) => {
      const r = verifyFile(Buffer.from('x'), sigWith(pem, patch), hex);
      assert.equal(r.ok, false);
      assert.match(r.reason, /^malformed signature file/);
    };
    bad({ alg: 'rsa' });
    bad({ keyId: 'bad id!' });
    bad({ signature: Buffer.alloc(63, 1).toString('base64') });
    bad({ signature: `${good.signature.slice(0, 10)}*${good.signature.slice(11)}` });
    bad({ signature: `${good.signature}\n` });
    bad({ extra: true });
    bad({ keyId: undefined });
    bad({ signature: undefined });
  });
});

test('keygen refuses to overwrite an existing key', () => {
  withTmp((dir) => {
    keygen(dir);
    assert.throws(
      () => execFileSync(process.execPath, [SCRIPT, 'keygen', '--out', dir], { stdio: 'pipe' }),
      (e) => e.status === 1,
    );
  });
});

test('cli sign with no key available fails', () => {
  withTmp((dir) => {
    const file = join(dir, 'doc');
    writeFileSync(file, 'x');
    const env = { ...process.env };
    delete env.PLUGIN_SIGNING_KEY;
    assert.throws(
      () =>
        execFileSync(process.execPath, [SCRIPT, 'sign', file, '--key-id', 'k1'], {
          env,
          stdio: 'pipe',
        }),
      (e) => e.status === 1 && /no signing key/.test(String(e.stderr)),
    );
  });
});

test('cli verify with a missing .sig', () => {
  withTmp((dir) => {
    const file = join(dir, 'doc');
    writeFileSync(file, 'x');
    assert.throws(
      () =>
        execFileSync(process.execPath, [SCRIPT, 'verify', file, '--public', 'a'.repeat(64)], {
          stdio: 'pipe',
        }),
      (e) => e.status === 1 && /verify: signature file missing/.test(String(e.stderr)),
    );
  });
});

test('non-ed25519 key is refused', () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => signFile(Buffer.from('x'), pem, 'k1'), /ed25519/);
  assert.throws(() => publicKeyHex(pem), /ed25519/);
});
