// Checks every bundle an index lists before the index is signed: the bundle bytes hash to the
// listed sha256, and its .sig verifies against the signing key.
//   node scripts/verify-catalog.mjs <index.json> --public <64 hex>
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { verifyFile } from './sign.mjs';

async function get(fetchFn, url) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Returns one problem string per failing bundle (empty when all verify). */
export async function verifyCatalog(index, publicHex, fetchFn = fetch) {
  const problems = [];
  for (const plugin of index.plugins) {
    for (const v of plugin.versions) {
      const label = `${plugin.name} ${v.version}`;
      try {
        const bytes = await get(fetchFn, v.url);
        const sha = createHash('sha256').update(bytes).digest('hex');
        if (sha !== v.sha256) {
          problems.push(`${label}: bundle sha256 ${sha} differs from the listed ${v.sha256}`);
          continue;
        }
        const sig = (await get(fetchFn, v.signature)).toString('utf8');
        const result = verifyFile(bytes, sig, publicHex);
        if (!result.ok) problems.push(`${label}: ${result.reason}`);
      } catch (e) {
        problems.push(`${label}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [file, flag, publicHex] = process.argv.slice(2);
  if (!file || flag !== '--public' || !publicHex) {
    console.error('usage: verify-catalog.mjs <index.json> --public <64 hex>');
    process.exit(1);
  }
  const problems = await verifyCatalog(JSON.parse(readFileSync(file, 'utf8')), publicHex);
  for (const p of problems) console.error(`verify-catalog: ${p}`);
  process.exit(problems.length > 0 ? 1 : 0);
}
