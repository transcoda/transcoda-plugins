// Static check of every built bundle (plugins/*/dist/*.js): a plugin must not reach for the
// filesystem, processes, threads, code generation or the global network. This is defence in
// depth for review; the plugin host's permission sandbox is the real boundary. This grep is
// defence in depth only: a bare `import 'fs'` (no node: prefix) is blocked earlier, by
// finalize-bundle.mjs, which rejects any import that is not a node: built-in.
// Usage: node scripts/check-bundles.mjs     (after `pnpm bundle`)
// Exports checkBundles(root) for tests; the CLI runs only when executed directly.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The SDK inlines context.ts, whose core-node context has a `fetch` that only throws. Exact text.
const SDK_FETCH_SHIM =
  /async fetch\(\)\s*\{\s*throw new FetchRefused\((["'])core nodes have no integration\1\);?\s*\}/g;

const RULES = [
  [
    /\bnode:(fs|fs\/promises|child_process|worker_threads|vm|inspector|module)\b/,
    (m) => `node:${m[1]}`,
  ],
  [/\bprocess\.binding\b/, () => 'process.binding'],
  // zod probes eval support with `new Function("")` (empty source); anything else fails.
  [/\bnew\s+Function\b(?!\s*\(\s*(?:""|'')\s*\))/, () => 'new Function'],
  // Function("...")() without `new` is the same thing (a `new Function` call is handled above).
  [/(?<!\bnew\s+)(?<![\w$.])Function\s*\(/, () => 'Function('],
  [/\beval\s*\(/, () => 'eval('],
  [/\bglobalThis\.fetch\b/, () => 'globalThis.fetch'],
  [/(?<![\w$.])fetch\s*\(/, () => 'bare fetch('],
];

export function checkBundles(root) {
  const errors = [];
  const pluginsDir = join(root, 'plugins');
  if (!existsSync(pluginsDir)) return errors;
  for (const name of readdirSync(pluginsDir)) {
    const dist = join(pluginsDir, name, 'dist');
    if (!existsSync(dist)) continue;
    for (const file of readdirSync(dist)) {
      if (!file.endsWith('.js')) continue;
      const text = readFileSync(join(dist, file), 'utf8').replace(SDK_FETCH_SHIM, '');
      for (const [pattern, label] of RULES) {
        const match = pattern.exec(text);
        if (match) {
          errors.push(
            `plugins/${name}/dist/${file}: uses ${label(match)}, which a plugin must not use`,
          );
        }
      }
    }
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const errors = checkBundles(root);
  for (const e of errors) console.error(`check-bundles: ${e}`);
  process.exit(errors.length > 0 ? 1 : 0);
}
