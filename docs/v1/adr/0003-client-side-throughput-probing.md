# ADR-0003: Client-side throughput probing instead of `navigator.connection`

## Status

Accepted — supersedes an earlier approach that guessed quality from a client-reported network label.

## Context

The very first streaming implementation picked a rendition using a `network` query parameter derived from `navigator.connection.effectiveType` (`slow-2g`/`2g`/`3g`/`4g`/`unknown`), mapped server-side to a target bitrate (`TracksService.targetBitrateForNetwork`). In practice this did not adapt correctly: `navigator.connection.effectiveType` does not reflect Chrome DevTools' network throttling simulation (it reports the browser's model of the real physical connection, which DevTools throttling doesn't change), and the API isn't implemented at all in Safari or Firefox. Testing with DevTools set to "3G" continued to select high-bitrate renditions and playback failed to start, which is what surfaced this as a real bug rather than a theoretical gap.

Separately, the original flow attached and began loading the `<audio>` source as soon as a track was selected, which meant browsing the catalog itself triggered network activity and made the network problem worse.

## Decision

1. **Measure, don't ask.** Before starting a stream, the client performs a small timed ranged `fetch()` (128 KB, `Range: bytes=0-131071`) against the lowest-bitrate rendition — always cheap and always available — and computes real bytes/sec (`probeThroughputBytesPerSecond` in `client/src/utils/streamCache.ts`).
2. **Pick with a safety margin.** `pickQualityForThroughput` selects the highest rendition whose bitrate, times a 1.4x safety factor (`ABR_SAFETY_FACTOR`), still fits under the measured throughput; if the probe fails (offline, timeout, error), it falls back to a conservative middle tier rather than guessing high.
3. **Lazy attachment.** The `<audio>` element has `preload="none"` and no bound `src` in JSX. `audio.src` is only ever set inside `ensureStreamReady()`, which runs on the first Play press or the first Seek for a track — never on mere track selection.
4. **Continuous re-evaluation.** While playing, a 25-second interval re-probes and upgrades in place if a higher tier is now affordable (`maybeUpgradeQuality`); two buffering stalls within 20 seconds trigger an immediate downgrade (`handleWaiting`).

## Consequences

- Adaptive behavior now responds correctly to real throttling (verified via DevTools network presets and `curl`-based timing), independent of browser support for the Network Information API.
- Every quality decision costs one small extra request (128 KB) before the "real" stream request — accepted as a small, bounded cost.
- Because attachment is lazy, selecting a track in the UI (e.g. browsing, or auto-advance while paused) causes zero network requests; only explicit Play or Seek starts a stream. Auto-advance/Next/Previous *while already playing* is intentionally treated as "was playing" and continues automatically.
- The old `network` query parameter and `targetBitrateForNetwork` server-side mapping remain in the codebase for the `quality=auto` fallback path (`streamingUrlFor`), but the primary client flow now always requests an explicit `quality=<tier>` chosen by throughput probing rather than relying on the server's network-guess.

## Update: warm-up request added

Real-world testing found the probe still under-selected quality on genuinely fast connections (e.g. Fast 4G throttling picking a low/normal rendition instead of very-high). The 128 KB timed sample included the cost of establishing the connection (DNS, TLS handshake, TCP slow-start) as part of the measured window — for a small sample, that one-time setup cost dominates the timing and makes even a fast connection look slow, especially since the probe is typically the first request made to the origin in a session.

`probeThroughputBytesPerSecond` now issues a small (16 KB) `Range` fetch against the same URL first, discards it entirely, and only starts the timer for the *next* fetch (the same 128 KB sample as before, at a shifted byte offset). This means every quality decision now costs two small requests instead of one, but the timed portion measures sustained throughput on an already-open connection rather than being skewed by one-time setup cost.
