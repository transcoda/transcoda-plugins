# transcoda-plugins

Official plugins for [Transcoda](https://github.com/transcoda/transcoda): integrations such as
Sonarr, Radarr, Jellyfin, TMDB and notifications. Each plugin is built against the versioned
plugin SDK (`@transcoda/sdk`) and shipped as one self-contained JavaScript file that Transcoda
installs into `/config/plugins` and runs in its sandboxed plugin host.

## The plugins

- **Sonarr**: after a transcode replaces a file, tells Sonarr to rescan the series and checks that
  Sonarr lists the new file. Needs Sonarr's URL and API key.
- **Radarr**: the same for movies. Needs Radarr's URL and API key.
- **Jellyfin**: refreshes the library after a file changes. Needs Jellyfin's URL and an API key.
- **TMDB**: looks up a movie or show on TMDB and outputs its original language, so a workflow
  can branch on it. Needs a TMDB API key.
- **ntfy**: sends a notification when a job finishes or needs attention. Needs an ntfy server
  URL and topic (and a token if the topic is protected).
- **Discord**: posts the same notification to a channel through a webhook. Needs the webhook URL.

Emby and Plex are wanted as community plugins: their APIs cannot be verified here (nobody on the
team runs either), so there are no official ones. Anyone who does can build them against the SDK.

This product uses the TMDB API but is not endorsed or certified by TMDB.

What a plugin can and cannot do inside the sandbox is described in core's
`docs/plugin-sdk.md`, section "What the sandbox does and does not do".

## Layout

```
plugins/<name>/            one plugin per directory (kebab-case; also the release tag prefix)
  package.json             @transcoda/plugin-<name>, version, "transcoda": { "sdk": "^1" }
  src/index.ts             default export: definePlugin(...); named export `nodes`
  tsdown.config.ts         uses scripts/plugin-bundle-config.ts
packages/<name>/           shared code (for example arr-common for Sonarr and Radarr); inlined
                           into the bundles that use it, never released on its own
test/
  setup.ts                 runs before every test file; stubs the global fetch so tests cannot
                           reach the network
  fixtures/                recorded-style JSON responses (see its README)
.changes/<plugin>/         release notes, one small file per user-facing change
scripts/
  plugin-bundle-config.ts  shared tsdown config (ESM, node24, every dependency inlined)
  finalize-bundle.mjs      checks the bundle is self-contained, writes the sha256 file and the
                           <name>-<version>.manifest.json the catalog is built from
  bundle-manifest.mjs      prints what a built bundle announces, including each node's version and
                           migrations (run sandboxed by finalize-bundle)
  check-bundles.mjs        fails when a built bundle uses node:fs, child_process, worker_threads,
                           vm, inspector, process.binding, eval, new Function or the global fetch
  check-release-note.mjs   release-note rules: a PR adds a note or carries the label; --lint
  release-notes.mjs        turns .changes/<plugin>/ into the release body, grouped by type
  check-plugins.mjs        manifest rules (name, semver, transcoda.sdk range, no runtime deps)
  host-check.mjs           starts every built bundle in core's sandboxed host (--check-plugin)
  sign.mjs                 ed25519 keygen / sign / verify (bundles, catalog index, blocklist)
  build-catalog.mjs        GitHub releases -> catalog index.json (one signed entry per version)
  check-blocklist.mjs      validates catalog/blocklist.json
  verify-catalog.mjs       checks every bundle an index lists (checksum and signature) before it is signed
catalog/
  blocklist.json           hand-edited blocklist source; CI signs and publishes it
.github/
  actions/setup            checks out the core repo next to this one and installs both
  workflows/ci.yml         typecheck, lint, test, bundle against each supported core version
  workflows/release.yml    builds, signs, attests and releases one plugin per tag
  workflows/release-note.yml  PR check: a release note or the `no user-facing change` label
  workflows/catalog.yml    builds and signs index.json and blocklist.json, pushes to branch `catalog`
```

`plugins/example` is a minimal reference plugin on SDK 1.0: one condition node
(`example:extension-is`) defined with `defineNode`, a `definePlugin({ name: 'example', ... })`
default export (the bare name; `package.json` keeps `@transcoda/plugin-example`) and tests on
`@transcoda/sdk/testing`.

## Plugin rules

- **Self-contained bundles.** Plugins are never `npm install`ed by Transcoda. Everything a
  plugin needs is inlined by tsdown into `dist/<name>-<version>.js`; only `node:` built-ins
  stay external. Plugin manifests therefore have **no `dependencies`** (only
  `devDependencies`) and no install scripts. `pnpm check-plugins` and the bundle step enforce
  this.
- **SDK compatibility.** `"transcoda": { "sdk": "<semver range>" }` in the plugin's
  `package.json` declares the SDK major it is built for; the plugin host checks it against the
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

- `pnpm check`: typecheck, lint (Biome), manifest rules, release-note lint, script tests,
  tests (Vitest).
- `node scripts/check-bundles.mjs` (after `pnpm bundle`): static check of every built bundle.
- `pnpm bundle`: builds every plugin to `plugins/<name>/dist/<name>-<version>.js` plus
  `<name>-<version>.js.sha256` (`sha256sum` format; verify with `sha256sum --check`).
- `node scripts/host-check.mjs` (after `pnpm bundle`): builds core's server at `../transcoda` and runs
  every bundle through `--check-plugin`; fails when a bundle does not start or its `sdk` range is not
  satisfied by core's SDK. `pnpm bundle` also writes `<name>-<version>.manifest.json` and fails when
  the bundle's announced name, version or sdk differ from the package.
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
the bundle, verifies the checksum, signs the bundle, attests its build provenance
(`actions/attest-build-provenance`) and creates a GitHub release with
`<name>-<version>.js`, `<name>-<version>.js.sha256`, `<name>-<version>.js.sig` and
`<name>-<version>.manifest.json` attached; the catalog workflow then publishes the new version
(see "Signing and the catalog"). The release body names the core version, carries an
`Attestation: <url>` line the catalog reads, and lists the plugin's release notes (below).
Versions with a pre-release suffix (`-beta.1`) are marked as pre-releases.

## Release notes

Every pull request that changes something a user can notice adds a note,
`.changes/<plugin>/<short-name>.md`, with front matter `type: new|improved|fixed|breaking` and
one or two sentences for people who use Transcoda (format in `.changes/README.md`). A pull
request with no user-facing change gets the `no user-facing change` label instead; CI checks
for one of the two. The release workflow pastes the plugin's notes into the release, grouped
New, Improved, Fixed and Breaking. Removing the notes a release consumed is a manual follow-up.

A plugin bumps its major version when it drops support for an SDK major; widening the
`transcoda.sdk` range is a minor release.

## Signing and the catalog

Transcoda only installs official bundles that carry a valid ed25519 signature, and verifies
the catalog index and the blocklist the same way. One key signs all three. It lives in two
secrets of the GitHub **environment** `plugin-signing` (not repository secrets, so no other
job or workflow can read them): `PLUGIN_SIGNING_KEY` (the private key, PKCS8 PEM) and
`PLUGIN_SIGNING_KEY_ID` (the key id, `A-Za-z0-9._-`, at most 64 characters). Only the
`release` job in `release.yml` and the `publish` job in `catalog.yml` declare that
environment, and every action those jobs use is pinned to a full commit SHA.

Settings the maintainer configures once (Settings > Environments > New environment >
`plugin-signing`):

- **Required reviewers:** at least one maintainer (enable "Prevent self-review" if there is a
  second maintainer), so every run that touches the key waits for an approval.
- **Deployment branches and tags:** "Selected branches and tags" with `main` (catalog runs) and
  a tag rule `*-v*` (release runs). Nothing else may deploy to the environment.
- **Environment secrets:** add `PLUGIN_SIGNING_KEY` and `PLUGIN_SIGNING_KEY_ID` here, and
  delete any repository-level secrets of the same names.
- Leave "Allow administrators to bypass" off if the plan offers it, and keep the tag
  `*-v*` creation restricted to maintainers (a tag ruleset), since a pushed tag starts a release.

```bash
node scripts/sign.mjs keygen --out <dir>
```

`keygen` writes `signing-key.pem` (mode 0600, refuses to overwrite) and prints the public key
as 64 hex characters. Pin that public key, with its id, in core's
`apps/server/src/plugins/official-keys.ts`, store the PEM in the secret, and never commit the
PEM. Until a build of Transcoda pins the key, it refuses the official catalog. `sign.mjs sign
<file> --key-id <id>` writes `<file>.sig` and `sign.mjs verify <file> --public <hex>` checks one.

- **Bundles.** The release workflow signs `<name>-<version>.js`, verifies the signature again
  and uploads `<name>-<version>.js.sig` next to the bundle. The signature covers the bundle's
  exact bytes.
- **Catalog.** `.github/workflows/catalog.yml` builds `index.json` from the releases (each
  version lists its `signature` url), checks that every listed bundle matches its checksum
  and verifies against the key, signs the index, and pushes `index.json`, `blocklist.json` and
  their `.sig` files to the `catalog` branch. It runs after a successful Release, on an edit
  of `catalog/blocklist.json` on `main`, or by hand from `main`. A failed index build does not
  keep the blocklist from being published; the job still fails and the branch keeps its
  previous `index.json`.

A signature file is `{ "schema": 1, "alg": "ed25519", "keyId": "<id>", "signature": "<base64
of the 64-byte signature>" }`, beside its document at `<url>.sig`.

### Blocklisting a build

`catalog/blocklist.json` on `main` is the hand-edited source:
`{ "schema": 1, "generated": "<ISO datetime>", "entries": [ ... ] }` (CI sets `generated` when
it publishes). An entry has an `id` (1 to 64 characters, unique), a `reason` (1 to 200
characters, shown to users), `added` (ISO datetime, not later than `generated`), an optional
advisory `url` (https), and a way to name the build: `sha256` (the bundle's 64-character hash)
or `name` with an optional `versions` semver range (`versions` needs `name`). For example, an
entry with `name: "sonarr"`, `versions: "<1.2.1"` and a reason blocks every older Sonarr
build, while one with only a `sha256` blocks that single file. An entry that has both `sha256`
and `name` matches either: the named plugin (in the `versions` range, if given) or the build
with that hash.

`pnpm check` (the `check-blocklist` step) validates the file; merging the change to `main`
publishes it, and running servers pick it up within an hour (or at their next start). Transcoda
stops an installed plugin the list names, with the reason shown on its card, refuses to install
a listed build, and keeps enforcing the last good list when it cannot fetch a new one. One
invalid entry makes the whole document invalid, so check before you merge.

### Rotating the key

1. Generate the new key, add its public key to `official-keys.ts` next to the old one, and
   release core.
2. Switch the `PLUGIN_SIGNING_KEY` and `PLUGIN_SIGNING_KEY_ID` secrets to the new key (new
   releases, the index and the blocklist are then signed with it; old bundles keep their old
   signature and stay valid while the old key is pinned).
3. Remove the old key from `official-keys.ts` two core releases later. A plugin still signed
   with it then stops at its next start with `signed with an unknown key <id>` until it is
   updated to a rebuilt release.

### If the key is compromised

Do these in this order; the order matters because the blocklist and index must be signed by a
key the servers already trust.

1. Generate a new key (`node scripts/sign.mjs keygen --out <dir>`).
2. Release core with the new public key pinned in `official-keys.ts` and the compromised key
   removed.
3. Put the new key and id in the `plugin-signing` environment secrets, then re-sign the index
   and the blocklist with it (run the Catalog workflow by hand from `main`).
4. Add `sha256` entries for every build signed with the compromised key (and any build you
   cannot vouch for) to `catalog/blocklist.json`, merge to `main`, and let the Catalog workflow
   publish it.
5. Re-release the plugins you still support, so they carry a signature from the new key.

Servers running an older core still pin the compromised key and have no protection until they
update to the core release from step 2; say so in the advisory.

## License

GPL-3.0-only, see [LICENSE](LICENSE).
