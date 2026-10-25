# Contributing to transcoda-plugins

Thanks for helping. Bug reports, fixes and new plugins are all welcome.

## Before you start

- **Bug or idea for a plugin?** [Open an issue](https://github.com/transcoda/transcoda-plugins/issues/new). Name the plugin and its version (Transcoda's Plugins page shows it).
- **Problem with Transcoda itself** (the editor, jobs, the Plugins page)? Report it in [transcoda](https://github.com/transcoda/transcoda/issues).
- **Security problem?** Don't open an issue; follow [SECURITY.md](SECURITY.md).
- **New plugin?** Open an issue first, so we can agree on what it does before you build it.

## Setting up

You need Node 24 (see `.node-version`), pnpm (`corepack enable`) and a checkout of the core repository next to this one, because plugins build against its SDK:

```sh
git clone https://github.com/transcoda/transcoda.git
git clone https://github.com/<you>/transcoda-plugins.git
(cd transcoda && pnpm install)
cd transcoda-plugins
pnpm install
pnpm check    # typecheck, lint, manifest rules, tests
pnpm bundle   # builds every plugin into plugins/<name>/dist/
```

`plugins/example` is the smallest complete plugin. The SDK is described in core's [`docs/plugin-sdk.md`](https://github.com/transcoda/transcoda/blob/main/docs/plugin-sdk.md).

## Making a pull request

1. Fork the repository and create a branch from `main`.
2. Keep it to one change, and add tests. Tests never reach the network; use the recorded responses in `test/fixtures/`.
3. Run `pnpm check` and make sure it passes.
4. Add a release note in the plugin's folder: `.changes/<plugin>/<short-name>.md` ([format](.changes/README.md)). A change users won't notice needs none; a maintainer adds the `no user-facing change` label.
5. Open the pull request and fill in the template.

Never put API keys, tokens, webhook URLs or real media file names in code, tests or screenshots. Use made-up titles in the usual release format.

## How pull requests get merged

- CI must pass.
- A maintainer reviews it; every pull request from a contributor needs a maintainer's approval.
- A maintainer squash-merges it: the pull request title becomes the commit message.
- A maintainer releases the plugin when it's ready (each plugin has its own version; see [`docs/maintaining.md`](docs/maintaining.md#versioning-and-releases)).

## License

By opening a pull request you confirm that the contribution is your own work and may be distributed under the project's license (GPL-3.0-only).
