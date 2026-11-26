---
type: fixed
---
After Transcoda replaces a file in place, Refresh in Jellyfin now has Jellyfin read the new file again. Before, Jellyfin could keep the old file's audio and subtitle tracks, and playback failed on the tracks that no longer existed.
