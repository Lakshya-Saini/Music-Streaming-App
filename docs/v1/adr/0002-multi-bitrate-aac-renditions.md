# ADR-0002: Pre-encoded multi-bitrate AAC renditions instead of HLS/DASH

## Status

Accepted

## Context

Users on different connection qualities need different audio bitrates: a fixed 320 kbps stream fails outright on a throttled/3G connection, while always serving 64 kbps wastes quality for users who could sustain much more. The "correct" long-term answer to this is segment-level adaptive streaming (HLS/DASH), where a single logical track is split into small time-segments per bitrate and the player can switch bitrate mid-segment. That requires a segmenter, manifest generation, and a more complex player (or a library like hls.js).

## Decision

For v1, every track is encoded into four **whole-file** AAC-LC renditions at ingest time — 64 / 128 / 256 / 320 kbps, each a single `.m4a` file with `-movflags +faststart` — rather than being segmented. The client picks one rendition to start playback (see [ADR-0003](0003-client-side-throughput-probing.md)) and can swap to a different whole file in place if conditions change mid-playback (`switchToAsset` in `MusicPlayer.tsx`), preserving playback position across the swap.

`+faststart` moves the MP4 `moov` atom near the start of the file, which is what makes true random-access `Range`-based seeking work efficiently on a single whole-file rendition (see [ADR-0004](0004-native-range-based-seeking.md)) — this was the substitute for real segment boundaries.

## Consequences

- Simple to implement and reason about: four independent files, `AudioAsset` documents that map 1:1 to S3 objects, ordinary HTTP `Range` GETs for playback.
- Quality switches are not seamless mid-segment the way HLS would be — swapping rendition means reloading `audio.src` and re-seeking to the saved position, which causes a brief stall (shown via the buffering spinner) rather than an invisible bitrate step.
- Storage cost is 4x the audio data per track compared to a single master, which is acceptable given typical track sizes.
- Migrating to HLS/DASH later is possible without breaking the data model: `AudioAsset.version` already exists specifically so a new encoding strategy can ship as `v2` without touching `v1` assets or `Track.activeAudioVersion` for tracks that haven't been re-encoded.
