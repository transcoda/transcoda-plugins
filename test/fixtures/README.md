# Test fixtures

Recorded-style JSON responses that plugin tests script through `fakePluginContext({ responses })`.
No test opens a socket: the fake context throws `FetchFailed` on any unscripted call, and
`test/setup.ts` stubs `globalThis.fetch` to throw.

## How these were made

Hand-written from the field lists in the M3 integrations research and the public API docs
(Sonarr v3 API as served by 4.0.x, Radarr v3 API, the Overseerr v1 API as Seerr serves it, the Jellyfin system endpoints, TMDB v3). They
are shaped like real responses but contain **no real server data and no keys**: the media is
fictional (`Example Show`, `Example Movie`), addresses are documentation addresses
(`192.0.2.x`), ids and hashes are made up. `arr/series.json` deliberately holds `Example Show` and
`Example Show 2` so path-prefix matching can be tested against siblings.

| Folder | Files |
|---|---|
| `arr/` | Sonarr and Radarr `system/status`, `config/mediamanagement`, `series`, `episodefile`, `episode`, `movie`, `moviefile`, `history` (movie, series), `blocklist` (one page each), and a `command` in the queued, completed and failed states |
| `webhooks/` | What Sonarr and Radarr POST: download, upgrade, import complete, rename, test (phase 3 reads these; recorded now so the shapes are settled) |
| `jellyfin/` | `System/Info/Public` (no auth) and `System/Info` (authenticated) |
| `bazarr/` | `api/system/status`, `api/series`, `api/episodes` (series 1), `api/movies`, and `api/movies` for one movie (`radarrid[]=7`); `Example Show` and `Example Show 2` again, one episode with an external `en` subtitle and an embedded forced `de` one |
| `seerr/` | Seerr (Jellyseerr/Overseerr v1 API) `status`, `auth/me`, a requested and an unrequested movie, a requested show, and a `search` with a movie, a show and a person; users are the fictional `Alex` and `alex@example.invalid` |
| `tmdb/` | `authentication`, movie 603, tv 1399, `find` by IMDb id, and movie/tv searches with one, many and no result |

## Replacing a fixture with a real recording

Jan may replace any file with a recording from his own server during the gate. Before it goes
into the repo, redact it:

- Remove or replace every API key, token, password, cookie and `Authorization` value. Recorded
  headers are never kept; keep the JSON body only.
- Replace the server's real addresses, host names and user names with documentation values
  (`192.0.2.10`, `example.invalid`).
- Replace personal paths and library titles you do not want public with the `Example ...` names.
- Search the file for the key and for your host name before staging it
  (`grep -ri '<key>' test/fixtures`).
