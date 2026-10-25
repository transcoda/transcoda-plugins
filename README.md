# Transcoda plugins

Official plugins for [Transcoda](https://github.com/transcoda/transcoda). They connect your
workflows to the apps around your media library: ask Sonarr which language a show is in, tell
Jellyfin a file changed, get a push when a job is done.

## The plugins

| Plugin | What it does | Needs |
| --- | --- | --- |
| **Sonarr** | Reads a series' original language; rescans the series after a file is replaced. | URL and API key |
| **Radarr** | The same for movies. | URL and API key |
| **Jellyfin** | Rescans a file or the whole library after a file is replaced. | URL and API key |
| **Bazarr** | Checks which subtitles a file has, fetches missing ones before a rewrite, rescans after. | URL and API key |
| **Seerr** | Tells you whether a title was requested, by whom and when (Jellyseerr, Overseerr). | URL and API key |
| **TMDB** | Looks a title up on TMDB to find its original language. | TMDB API key |
| **ntfy** | Sends a push when a file is done, and optionally when a job fails. | Server URL and topic |
| **Discord** | Posts the same message to a channel. | Webhook URL |

## Installing

You don't download anything from here. In Transcoda, open **Plugins**, pick a plugin from the
catalog and install it, then fill in its settings. Transcoda only installs builds signed by this
repository and checks every download. Updates show up on the same page.

Step-by-step setup for each plugin, and a ready-made workflow that uses them:
[`docs/plugins.md`](https://github.com/transcoda/transcoda/blob/main/docs/plugins.md) in the
Transcoda repository.

## Is it safe?

Each plugin runs in its own sandboxed process: it can't read or write your media, start programs
or see other plugins' settings, and gets only the data Transcoda hands it. The sandbox protects
against accidents, not against a plugin written to do harm (it can still use the network freely),
so only install plugins you trust. What it does and doesn't do:
[the SDK guide](https://github.com/transcoda/transcoda/blob/main/docs/plugin-sdk.md#what-the-sandbox-does-and-does-not-do).
To report a security problem, see [SECURITY.md](SECURITY.md).

## Missing an app?

Emby and Plex are wanted as community plugins: nobody on the team runs them, so there are no
official ones. Anyone can build a plugin with the SDK; `plugins/example` is a minimal one to start
from. See [CONTRIBUTING.md](CONTRIBUTING.md).

Maintainers: layout, releases, signing and the blocklist are in
[`docs/maintaining.md`](docs/maintaining.md).

This product uses the TMDB API but is not endorsed or certified by TMDB.

## License

GPL-3.0-only, see [LICENSE](LICENSE).
