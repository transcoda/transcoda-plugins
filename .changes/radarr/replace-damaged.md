---
type: new
---
Replace damaged file: after Transcoda finds a damaged source, the plugin blocklists the release, deletes the file through Radarr (its recycle bin applies), monitors the movie again when Radarr unmonitors deleted movies, and starts a search, at most once per movie in 7 days.
