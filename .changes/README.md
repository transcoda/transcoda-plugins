# Release notes

Every pull request that changes something a user can notice adds one small file here. At release time these files become the changelog on GitHub, then they are removed.

## Format

Name the file after the change, for example `.changes/sonarr-verify-path.md`, starting with the plugin name:

```markdown
---
type: improved
---
The Sonarr plugin now checks that the series path exists before it asks Sonarr to rescan.
```

- Start the file name with the plugin it changes (`sonarr-`, `radarr-`, ...); a change to several plugins gets one file each.
- `type` is one of `new`, `improved`, `fixed`, `breaking`.
- Write one or two sentences for people who use the plugin, not for developers: what they will notice and, if it matters, what they need to do. No code, commit hashes or internal names.
- For `breaking`, say what a user has to change after updating the plugin.

A pull request with no user-facing change (refactor, tests, tooling, CI) needs no file; a maintainer adds the `no user-facing change` label instead.
