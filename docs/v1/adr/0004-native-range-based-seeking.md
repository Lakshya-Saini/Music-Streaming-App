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

## Update: debounced writes and concurrency guards added after rapid-seeking reports

Setting `audio.currentTime` directly on every seek call, as described above, turned out to be insufficient once a real user started seeking *repeatedly and rapidly* (slider dragging, or mashing the arrow keys) rather than performing one seek at a time:

1. Each `currentTime` write aborts whatever `Range` request is in flight for the previous target and starts a new one. A rapid burst of writes therefore produced a rapid burst of aborted/restarted requests, which could push the media resource into a genuine network error — and once that happened, nothing recovered it (see [the stuck-playback issue writeup](../issues/client-issues.md#rapid-seeking-could-wedge-playback-until-a-page-refresh)).
2. Each seek to an unbuffered position also fires the native `waiting` event while the new range loads, which `handleWaiting()`'s stall-counting logic (see [ADR-0003 §4](0003-client-side-throughput-probing.md)) couldn't distinguish from a genuine bandwidth stall — so rapid seeking alone could cascade the quality down through every tier, and a subsequent quality switch racing a still-in-flight one could then reject its own `play()` call (see [the quality-switch race issue writeup](../issues/client-issues.md#rapid-seeking-triggered-cascading-quality-downgrades-and-a-switchtoasset-race)).

`seekTo()` now updates the UI's displayed position immediately but debounces the actual `audio.currentTime` write by 150ms (`SEEK_DEBOUNCE_MS`), so a rapid run of seek requests collapses into one write at the last requested position instead of one write per request. `onSeeking`/`onSeeked` also set an `isSeekingRef` flag that `handleWaiting()` checks before counting a stall, so seek-induced buffering no longer contributes to the downgrade heuristic. This preserves the original decision in this ADR (no manual prefetch, native range-based seeking) — only the cadence of the `currentTime` write and the stall-detection logic changed.
