// Where a plugin's integration may send requests, derived from its `allowedOrigins` exactly as the
// SDK's `pluginNetwork` does (SDK 1.3.0): fixed origins as `{ origin }`, `$settings.<field>` as
// `{ setting, label }`, the label being the setting's description up to its first comma, else the
// key. In order, without repeats; no integration: nothing. Core compares this list with the one
// it derives from the bundle at start, so the two must stay identical
// (test/plugin-network.test.ts checks it against the SDK once the SDK has it).

/** @returns {Array<{ origin: string } | { setting: string, label: string }>} */
export function pluginNetwork(integration) {
  if (!integration) return [];
  const seen = new Set();
  const out = [];
  for (const entry of integration.allowedOrigins ?? []) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    if (!entry.startsWith('$settings.')) {
      out.push({ origin: entry });
      continue;
    }
    const key = entry.slice('$settings.'.length);
    const described = integration.settings?.shape?.[key]?.description;
    const label = (typeof described === 'string' ? described.split(',')[0] : '')?.trim();
    out.push({ setting: key, label: (label ? label : key).slice(0, 200) });
  }
  return out;
}
