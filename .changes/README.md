# Release notes

Every pull request that changes something a user can notice adds one small file here. At release time these files become the notes of the GitHub release, grouped New, Improved, Fixed and Breaking.

## Format

One folder per plugin, because releases are per plugin. Name the file after the change, for example `.changes/sonarr/verify-path.md`:

```markdown
---
type: improved
---
The Sonarr plugin now checks that the series path exists before it asks Sonarr to rescan.
```

- The folder is the plugin it changes (`sonarr`, `radarr`, ...) and must be a directory under `plugins/`; a change to several plugins gets one file each. The flat form `.changes/<plugin>-<short-name>.md` is accepted too.
- `type` is one of `new`, `improved`, `fixed`, `breaking`.
- Write one or two sentences for people who use the plugin, not for developers: what they will notice and, if it matters, what they need to do. No code, commit hashes or internal names.
- For `breaking`, say what a user has to change after updating the plugin.

A pull request with no user-facing change (refactor, tests, tooling, CI) needs no file; a maintainer adds the `no user-facing change` label instead.

`pnpm check-plugins` validates every note that exists; `.github/workflows/release-note.yml` checks that a pull request adds one (or carries the label).

Notes are not removed automatically when a release is cut: after tagging, delete the notes that release consumed in a follow-up pull request.

The flat form is ambiguous when plugin names share a prefix: `arr-common-x.md` could belong to `arr` or `arr-common`; prefer the folder form for any plugin whose name is a prefix of another's.

Consumed notes must be removed at release: delete them in the follow-up pull request, or they are published again in the next release of the same plugin.
