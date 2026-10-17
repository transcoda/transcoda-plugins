// `node --permission --allow-fs-read=<bundle> scripts/bundle-manifest.mjs <bundle>`: imports a built
// plugin bundle and prints its manifest (what the host would announce) as one JSON line. Run by
// finalize-bundle.mjs in a sandboxed child so building a plugin never runs it unrestricted.
// The manifest is derived here exactly as the SDK's `pluginManifest` does (names only, no code).
import { pathToFileURL } from 'node:url';

// Keep in step with core's HOOK_EVENT_NAMES (packages/shared/src/plugins/types.ts).
const HOOKS = ['onJobDone', 'onJobFailed', 'afterReplace'];

const file = process.argv[2];
if (!file) {
  console.error('usage: bundle-manifest.mjs <bundle.js>');
  process.exit(2);
}
const plugin = (await import(pathToFileURL(file).href)).default;
if (plugin === null || typeof plugin !== 'object' || typeof plugin.name !== 'string') {
  console.error('bundle has no plugin default export');
  process.exit(1);
}
console.log(
  JSON.stringify({
    name: plugin.name,
    version: plugin.version,
    sdk: plugin.sdk,
    nodes: (Array.isArray(plugin.nodes) ? plugin.nodes : []).map((n) => n.type),
    integration: plugin.integration?.id ?? null,
    triggers: (plugin.triggers ?? []).map((t) => t.id),
    hooks: HOOKS.filter((h) => typeof plugin.hooks?.[h] === 'function'),
  }),
);
