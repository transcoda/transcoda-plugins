---
type: fixed
---
Rescan in Radarr now handles a file whose container changed (for example `.mp4` to `.mkv`) when Radarr has already dropped the old file: it finds the movie by the new file's folder and rescans it, instead of failing with "does not know". A rescan whose status Radarr never reported before the time limit is now retried, the same as a rescan that timed out.
