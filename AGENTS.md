# Agent instructions

For coding agents working in this repository. [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/maintaining.md](docs/maintaining.md) apply; this file is the short version, plus the rules
agents tend to skip.

## Repo map

```
plugins/<name>/          one plugin each: bazarr, discord, example, jellyfin, ntfy, radarr, seerr,
                         sonarr, tmdb. The directory name is the plugin name and the release tag prefix.
  package.json           @transcoda/plugin-<name>, version, transcoda.sdk range, transcoda.title
  src/index.ts           default export definePlugin(...); everything the bundle holds starts here
  src/*.test.ts          tests, next to the code they test
  src/test-util.ts       the plugin's test helpers (the only name allowed; index.ts never imports it)
packages/arr-common/     code Sonarr and Radarr share (client, commands, errors, integration test,
                         paths, replace); inlined into their bundles, never released on its own
packages/test-utils/     test-only helpers every plugin's tests share (assertSecretHygiene); never
                         imported by plugin source, so never in a bundle
test/                    setup.ts (stubs fetch: no test reaches the network), fixtures/<service>/
                         (invented, recorded-style JSON), cross-plugin tests
scripts/                 check-plugins, check-bundles, host-check, release notes, signing, catalog
                         (each *.mjs has a *.test.mjs run by node:test)
.changes/<plugin>/       release notes, one file per user-facing change
docs/maintaining.md      layout, SDK pin, releases, signing, catalog, blocklist
```

Core ([transcoda/transcoda](https://github.com/transcoda/transcoda)) must be checked out next to
this repo as `../transcoda` (and `pnpm install`ed): `pnpm check` reads its example workflow and the
host check runs every bundle in its plugin host. The SDK itself comes from npm (`@transcoda/sdk`);
its reference is core's `docs/plugin-sdk.md` and `packages/sdk/README.md`.

## What "done" means

All of these pass locally, in this order:

```bash
pnpm check                      # typecheck, lint, check-plugins, release-note lint, script tests,
                                # blocklist, file-size budget, vitest
pnpm bundle                     # builds plugins/<name>/dist/<name>-<version>.js
node scripts/check-bundles.mjs  # no fs, child_process, eval, global fetch ... in a bundle
node scripts/host-check.mjs     # starts every bundle in core's sandboxed host
```

If `host-check` fails with `ERR_PNPM_BAD_PM_VERSION` (core and this repo pin different pnpm
versions and corepack will not switch), build core's server from inside core and skip the build:
`(cd ../transcoda && pnpm --filter @transcoda/server build) && node scripts/host-check.mjs --no-build`.

The shared rules come from [transcoda/.github](https://github.com/transcoda/.github), pinned at one
tag: `@transcoda/dev-config` (devDependency) for the Biome config (`biome.json` extends it), the
tsconfig base (every `tsconfig.json` extends it), the release-note format and its `transcoda-release-note`
and `transcoda-file-size` commands; and its actions in the workflows. Change a shared rule there, not
here; `biome.json` only adds this repo's files and exceptions. The lint is strict: no default
exports outside `plugins/*/src/index.ts`, `it` rather than `test`, `T[]` rather than `Array<T>`, no
floating promises (`void` one on purpose), no `any`, no non-null assertions, `.ts`/`.mjs` import
extensions. No source file grows past 1200 lines; `.github/file-size-allowlist.json` lists the
ones already over it, and their numbers may only go down.

And the pull request:

- **Release note or label.** A change a user can notice adds `.changes/<plugin>/<short-name>.md`
  (format in [.changes/README.md](.changes/README.md)); one file per plugin it changes. Anything
  else (tests, tooling, CI, docs, refactors) gets the `no user-facing change` label. The
  `release-note` check (the shared action, per-folder layout) wants one of the two; Renovate's pull
  requests need neither. A note has no commit hashes or pull request numbers.
- **Title in house style: `Area: sentence`.** The area is the plugin's name (`Sonarr`, `Jellyfin`,
  `Radarr, Sonarr` for both) or one of `CI`, `Tooling`, `Tests`, `Docs`, `Release notes`,
  `Dependencies`. The `pr-title` check (from `transcoda/.github`) wants the area to start with a
  capital letter or a digit (so `Ntfy`, not `ntfy`), no `(scope)`, one space after the colon and no
  full stop at the end: `Jellyfin: after an in-place replace, have Jellyfin read the new file`.
  The squash commit takes this title.
- **CI is green.** `ci-ok` passes only when every `check (core …)` job passed (core's `main` and
  the released cores in the matrix, see docs/maintaining.md, "Core versions CI tests against") and
  the `file-size` job did, which also stops a pull request from adding or raising an allowlist entry.
- **No version bump** unless you are releasing (below).

Never put real show or film titles, personal names, e-mail addresses, host names or IP addresses
in code, tests or fixtures. Fixtures use invented titles (`Example Show`, `Example Movie`),
documentation addresses (`192.0.2.x`, `example.invalid`) and made-up ids.

## Adding a plugin

1. **Copy the example.** `cp -R plugins/example plugins/<name>` (kebab-case). Keep
   `tsconfig.json`, `tsdown.config.ts` and `vitest.config.ts` as they are: they are one-liners over
   the shared config. In `package.json` set `name` to `@transcoda/plugin-<name>`, `version` to
   `1.0.0`, `description`, `transcoda.title` (the catalog's display name) and `transcoda.sdk`.
   Keep `@transcoda/sdk` at the same exact version as the root `package.json`; add `zod` as a
   devDependency if the plugin has settings. No `dependencies` and no install scripts.
2. **Pick the SDK range.** `^1` unless the plugin uses a later SDK minor's feature: `damagedOnly` or
   an output's `shownWhen` needs `^1.1`, an integration test result's `roots` `^1.2`,
   `pluginNetwork` `^1.3`. `pnpm check-plugins` finds all of these but `roots`, so check that one
   yourself; CI then runs the bundle in the oldest core the range allows.
3. **Write the plugin.** `src/index.ts` default-exports `definePlugin({ name: '<name>', version:
   pkg.version, sdk: pkg.transcoda.sdk, ... })`; node types are `<name>:<node>`. A service
   integration goes in `src/integration.ts` (`defineIntegration`, secrets through `secret()`,
   `allowedOrigins`, a `test()` that never throws for an expected failure). Shared Sonarr/Radarr-
   style code belongs in `packages/`, not copied between plugins.
4. **Tests.** Next to each module (`src/<module>.test.ts`), on `@transcoda/sdk/testing`
   (`fakePluginContext`, `runDecide`, `runFinishRun`, ...). Shared test helpers go in
   `src/test-util.ts` and nowhere else (no `test/` folder, no `fixtures.ts`); only tests import
   it. `pnpm check-plugins` enforces both.
   A plugin with a `secret()` setting must have `src/secret-hygiene.test.ts` (also enforced). It
   runs `test()` and every node and hook on success and on each failure (401, 500, unreachable,
   a thrown fetch error) and passes each context to `assertSecretHygiene(ctx, SECRET, outputs,
   { auth })` from `@transcoda/plugin-test-utils` (add it as a `workspace:*` devDependency).
   That fails when the secret is in a URL, header, body, log line or result, or a request lacks
   the expected `auth`. `plugins/sonarr/src/secret-hygiene.test.ts` is a short example.
   Code that takes arbitrary input (paths, names, text with a length limit, parsers) also gets
   fast-check properties; no fixed seed, run count from `FC_NUM_RUNS`. How to replay a failure:
   docs/maintaining.md, "Property tests".
5. **Fixtures.** Recorded-style responses in `test/fixtures/<service>/*.json`, listed in
   `test/fixtures/README.md`. Invented data only (see above).
6. **Release note.** `.changes/<name>/<short-name>.md`, `type: new`.
7. **Docs.** A row in the README's plugin table. In core, separately: the plugin's group in
   `apps/web/src/plugins/pluginGroups.ts` and its section in `docs/plugins.md`.
8. **Check.** Everything under "What done means". There is no catalog entry to write: the catalog
   is built from the GitHub releases.
9. **Release** after merging, as in docs/maintaining.md, "Versioning and releases": tag the merge
   commit `<name>-v1.0.0` and push the tag. The release workflow builds, signs and publishes it,
   and opens a pull request removing the release notes it published; merge that one too.

## Changing a plugin

- Behaviour changes need a release note in that plugin's folder; a release bumps `version` in
  its `package.json` in its own pull request, then the tag.
- A node's settings or ports change only with a new node `version` and a migration
  (`migrations` on `defineNode`).
- Raising a plugin's `transcoda.sdk` range is a minor release; dropping an SDK major is a major one.
- Moving the SDK pin moves every `package.json` in one pull request.

## When main or the nightly goes red

- A push run of CI, Catalog or Scorecard failing on `main` opens an issue labelled `main-red`
  (`.github/workflows/main-red.yml`); it is closed when that workflow passes on `main` again.
- The nightly (`.github/workflows/nightly.yml`, 07:47 UTC) runs only when this repo's `main` or
  core's `main` moved since its last run. It opens an issue labelled `nightly` per failing test, and
  one "the run failed outside its tests" issue when another step fails (typecheck, lint, bundle,
  host check); they close when the test or the run passes again.
