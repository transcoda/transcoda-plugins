# transcoda-plugins

Official plugins for [Transcoda](https://github.com/transcoda/transcoda): integrations such as
Sonarr, Radarr, Jellyfin, TMDB and notifications. Each plugin is built against the versioned
plugin SDK (`@transcoda/sdk`) and shipped as one self-contained JavaScript file that Transcoda
installs into `/config/plugins` and runs in its sandboxed plugin host.

## Layout

```
plugins/<name>/            one plugin per directory (kebab-case; also the release tag prefix)
  package.json             @transcoda/plugin-<name>, version, "transcoda": { "sdk": "^1" }
  src/index.ts             default export: definePlugin(...); named export `nodes`
  tsdown.config.ts         uses scripts/plugin-bundle-config.ts
scripts/
  plugin-bundle-config.ts  shared tsdown config (ESM, node24, every dependency inlined)
  finalize-bundle.mjs      checks the bundle is self-contained, writes the sha256 file
  check-plugins.mjs        manifest rules (name, semver, transcoda.sdk, no runtime deps)
.github/
  actions/setup            checks out the core repo next to this one and installs both
  workflows/ci.yml         typecheck, lint, test, bundle against each supported core version
  workflows/release.yml    builds and releases one plugin per tag
```

`plugins/example` is a minimal reference plugin: one condition node (`example:extension-is`)
defined with the SDK's `defineNode` and a `definePlugin` default export.

## Plugin rules

- **Self-contained bundles.** Plugins are never `npm install`ed by Transcoda. Everything a
  plugin needs is inlined by tsdown into `dist/<name>-<version>.js`; only `node:` built-ins
  stay external. Plugin manifests therefore have **no `dependencies`** (only
  `devDependencies`) and no install scripts. `pnpm check-plugins` and the bundle step enforce
  this.
- **SDK compatibility.** `"transcoda": { "sdk": "<semver range>" }` in the plugin's
  `package.json` declares the SDK major it is built for; the plugin host (M3) checks it against the
  running core's SDK version before loading the plugin.
- **Node types** are namespaced `<plugin>:<node>` (core uses `core:`).

## The SDK dependency (temporary)

`@transcoda/sdk` is not published yet, so plugins reference it from a checkout of the core repo
next to this one:

```
~/…/transcoda           core repo (branch with the SDK you build against), `pnpm install`ed
~/…/transcoda-plugins   this repo
```

with `"@transcoda/sdk": "link:../../../transcoda/packages/sdk"` in each plugin's
`devDependencies`. The SDK ships TypeScript source, so plugin tsconfigs set
`allowImportingTsExtensions`. CI does the same by checking out `transcoda/transcoda` into
`.core/` and symlinking it to `../transcoda` (needs a `CORE_REPO_TOKEN` secret with read access
while the core repo is private).

Once the SDK is published to npm this becomes an exact-pinned `"@transcoda/sdk": "1.x.y"`
devDependency, the `.github/actions/setup` core checkout goes away, and the CI matrix installs
the SDK version of each supported core release instead.

## Development

Requires Node 24 and pnpm 12.6.0 (`corepack enable` picks it up from `packageManager`).

```bash
pnpm install
```

```bash
pnpm check
```

```bash
pnpm bundle
```

- `pnpm check`: typecheck, lint (Biome), manifest rules, tests (Vitest).
- `pnpm bundle`: builds every plugin to `plugins/<name>/dist/<name>-<version>.js` plus
  `<name>-<version>.js.sha256` (`sha256sum` format; verify with `sha256sum --check`).
- `pnpm format`: apply Biome formatting and import sorting.
- One plugin only: `pnpm --filter ./plugins/example bundle`.

pnpm 12 blocks dependency install scripts; `allowBuilds` in `pnpm-workspace.yaml` lists the
ones that are deliberately left disabled.

## Versioning and releases

Every plugin is versioned independently with semver in its own `package.json`. To release:

1. Bump `version` in `plugins/<name>/package.json` and merge to `main`.
2. Tag the merge commit `<name>-v<version>` (e.g. `example-v0.1.0`, `sonarr-v1.2.0`) and push
   the tag.

The release workflow checks that the tag matches the manifest version, runs `pnpm check`, builds
the bundle, verifies the checksum and creates a GitHub release with
`<name>-<version>.js` and `<name>-<version>.js.sha256` attached. Versions with a pre-release
suffix (`-beta.1`) are marked as pre-releases. Artifact attestations (build provenance) are a
TODO in the workflow.

A plugin bumps its major version when it drops support for an SDK major; widening the
`transcoda.sdk` range is a minor release.

## License

GPL-3.0-only, see [LICENSE](LICENSE).
