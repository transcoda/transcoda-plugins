# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub: [report a vulnerability](https://github.com/transcoda/transcoda-plugins/security/advisories/new) (**Security → Report a vulnerability** on this repository). Do not open a public issue.

Useful to include: which plugin and version, what an attacker can do, and steps to reproduce. You will get an answer within a few days.

## Scope

In scope:

- The official plugins in `plugins/` and the shared code in `packages/`.
- The release and catalog workflows: signing, the catalog index, the blocklist and build attestations.
- Anything that lets a plugin leak a secret (API keys, tokens, webhook URLs) into logs, messages or job results.

The plugin sandbox itself (process isolation, the fetch proxy, signature checks in the server) lives in the [Transcoda server repository](https://github.com/transcoda/transcoda); reports about it are welcome here too and will be forwarded.

## Compromised builds

If a published plugin build is found to be malicious or vulnerable, its sha256 is added to the signed blocklist (`catalog/blocklist.json`). Transcoda servers refuse to install a blocklisted build and stop it if it is already installed, at the next blocklist check (within an hour). See "Blocklisting a build" in [`docs/maintaining.md`](docs/maintaining.md#blocklisting-a-build).

## Signing key

Official releases, the catalog and the blocklist are signed with an ed25519 key (key id `2026-10`) whose public half is pinned in the Transcoda server. If the key is ever compromised, the steps in [`docs/maintaining.md`](docs/maintaining.md#if-the-key-is-compromised) apply.
