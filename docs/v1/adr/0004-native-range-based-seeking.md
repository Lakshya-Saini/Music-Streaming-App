# ADR-0004: Native HTTP range-based seeking instead of manual prefix pre-fetching

## Status

Accepted — supersedes an earlier prefetch-on-seek approach that caused indefinite hangs.

## Context

An earlier implementation tried to guarantee that seeking forward "felt instant" by manually pre-fetching every byte from the start of the file up to the seek target (`preloadStreamPrefix()`) *before* moving `audio.currentTime`, on the theory that the player needed that prefix locally available first. A companion service worker (`stream-cache-worker.js`) cached that fetched prefix in the Cache Storage API so a later request for the same range could be answered locally.

This broke in practice: for a forward seek partway into a large, high-bitrate file, the manual prefetch could be several megabytes, done as a single blocking `await fetch()` that raced against the `<audio>` element's own simultaneous request for the same resource. Users reported seeking forward would enter an indefinite loading state and never resume playback, even on a fast connection.

The renditions are already encoded with `-movflags +faststart` (see [ADR-0002](0002-multi-bitrate-aac-renditions.md)), which places the MP4 index/metadata (`moov` atom) near the start of the file specifically so a media engine can perform true random-access seeking — jumping straight to an arbitrary byte offset and fetching only what's needed there — without needing the preceding bytes at all. A `curl` timing test against the stream endpoint confirmed this works well in practice: requesting a 64 KB chunk starting at the 40% offset of a 7.6 MB file returned in 88ms.

## Decision

Removed the manual prefix pre-fetch entirely. `seekTo()` in `MusicPlayer.tsx` now simply computes the clamped target time and sets `audio.currentTime = nextTime` directly, letting the browser's native HTTP Range-based seeking do the actual fetching — the same mechanism a real player like Spotify or YouTube Music relies on. `onSeeking`/`onSeeked` handlers on the `<audio>` element show/clear a buffering notice for whatever brief fetch the native seek needs, using the same `PlayerNotice` mechanism already used for initial buffering and stalls.

The now-dead `preloadStreamPrefix` function and its associated `seekRequestRef` guard were deleted. The `stream-cache-worker.js` service worker was investigated as a possible contributor but was ruled out by unregistering it and reproducing the same failure — the actual cause was the blocking prefetch, not the worker. The service worker was left in place since it's a harmless, best-effort complementary cache that passes through to the network for anything not already cached.

## Consequences

- Forward and backward seeking are both handled uniformly by the browser: if the target is already buffered (e.g. seeking backward within what's already played), the seek is effectively instant; if not, only the missing region near the target is fetched, not everything before it.
- Seeking no longer requires a companion cache layer to feel reasonable — correctness comes from the media engine's own range logic plus `+faststart`, not from application-level prefetching.
- `playableSeekTime()` still clamps seeks while offline to the contiguously-buffered range from the start of the file (`locallyLoadedThrough`), since a genuinely offline browser cannot issue a new range request for an unbuffered target — this offline guard was preserved from the previous implementation.
- This fix could not be end-to-end verified by literal audio playback within this project's browser-automation tooling (see [`issues/client-issues.md`](../issues/client-issues.md#automated-browser-tooling-cannot-play-audio) for why); verification instead relied on `tsc` type-checking, server access-log inspection (confirming only one small request fires, not a multi-megabyte prefix), and a `curl`-based timing test proving the server-side range behavior is fast and correct.
