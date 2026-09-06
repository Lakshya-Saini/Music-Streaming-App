# Client Issues — Found and Fixed

Issues discovered during development of the client, in the order they were addressed, with root cause and fix. File paths are relative to `client/`.

---

## Dark mode track titles rendered black and unreadable

**Symptom:** In dark mode, song titles on `TrackCard` were rendered in black text on a dark background, making them nearly invisible.

**Root cause:** `.track-card` is a `<button>` element. Browsers apply a default black `color` to `<button>` text unless a stylesheet overrides it, and `styles.css` never set an explicit `color` on `.track-card` — so it never picked up the theme's `--text` CSS variable the way other components did.

**Fix:** Added `color: var(--text);` to `.track-card` in `src/styles.css`, matching the existing convention already used by `.queue-item` (`color: inherit;`).

---

## Home page category sprawl

**Symptom:** The home page generated one row per distinct genre *and* one row per distinct language with no cap, producing on the order of 16 rows from a catalog of only 17 tracks — overwhelming and confusing for users.

**Root cause:** `buildCategories()` in `src/pages/HomePage.tsx` iterated every unique `genre` and every unique `language` value present in the catalog and created a row for each, regardless of how many tracks were in it.

**Fix:** Rewrote `buildCategories()` to cap the home page at a small, meaningful set of rows:
- `Recently Uploaded` (sorted by `createdAt` descending)
- `Trending Songs` (a stable, seeded shuffle via `hashTrackId()` — explicitly a placeholder, since there is no real play-count/analytics data yet to base "trending" on)
- Up to `MAX_GENRE_ROWS = 4` genre rows, only for genres with at least `MIN_TRACKS_PER_GENRE = 2` tracks, sorted by track count descending

Per-language rows were removed entirely from the home page.

---

## Adaptive bitrate never actually adapted to network conditions

**Symptom:** Selecting "3G" in the browser's network throttling controls caused playback to fail outright (the player kept requesting a high-bitrate rendition and it couldn't load in time); only "Fast 4G" reliably worked, regardless of the throttling setting chosen.

**Root cause:** Quality selection was driven by `navigator.connection.effectiveType`, a browser API that reports the browser's own model of the underlying physical connection — it does **not** reflect Chrome DevTools' network-throttling simulation, and the API doesn't exist at all in Safari or Firefox. The app was effectively always seeing "the real connection" (fast) regardless of the simulated throttle.

**Fix:** Replaced the connection-type guess with real, measured throughput: `probeThroughputBytesPerSecond()` (`src/utils/streamCache.ts`) performs a small timed ranged `fetch()` against the lowest-bitrate rendition before starting playback, and `pickQualityForThroughput()` selects the highest rendition that fits under the measured throughput with a safety margin. See [ADR-0003](../adr/0003-client-side-throughput-probing.md) for full detail, including the lazy-stream-attachment change made alongside this fix (streaming no longer starts merely by selecting a track — only on Play or Seek).

---

## No visible feedback while buffering — app looked broken on slow connections

**Symptom:** On a throttled connection, the player would silently stall with no visual indication, making the app appear frozen or broken rather than simply buffering.

**Root cause:** The player tracked a single free-text `playerMessage: string | null` used inconsistently for both real errors and transient stalls, and nothing in the primary transport controls reflected a "buffering" state distinctly from "paused."

**Fix:** Introduced a discriminated `PlayerNotice { kind: 'buffering' | 'error'; text: string }` state, with `showBuffering()`/`showError()`/`clearNotice()` helpers. The primary play/pause button (`.play-button.mini`) now shows a spinner (`Loader2` with a `spin` animation) whenever `notice?.kind === 'buffering'`, and a small tooltip-backed icon next to the track title reflects either state. Handlers were wired to the native `<audio>` events that correspond to real stalls (`onWaiting`) and, later, seeking (`onSeeking`/`onSeeked`).

---

## Quality only ever downgraded, never upgraded, after a network improvement

**Symptom:** After the throughput-probing fix above, a track that started on a low-bitrate rendition because of a temporary slowdown would stay on that rendition even after the connection recovered, since the only automatic quality change implemented was a downgrade on repeated stalls.

**Root cause:** `handleWaiting()` called `downgradeQuality()` after repeated stalls, but there was no corresponding path to move back up.

**Fix:** Added `maybeUpgradeQuality()`, re-probing throughput on a 25-second interval while playing (`UPGRADE_CHECK_INTERVAL_MS`) and switching up via the same `switchToAsset()` helper (which preserves playback position and resumes if already playing) whenever a higher tier becomes affordable.

---

## Infinite loading state on forward seek

**Symptom:** Manually seeking forward in a track (via the progress slider or arrow keys) would enter an indefinite loading/buffering state and never resume playback — reproducible even on a fast connection (Fast 4G throttling), not just a slow one.

**Root cause:** `seekTo()` called a `preloadStreamPrefix()` helper that performed a single blocking `await fetch()` for the *entire* byte range from the start of the file up to the seek target, before ever touching `audio.currentTime`. For a seek partway into a large or high-bitrate file this could be several megabytes, and this manual fetch raced against the `<audio>` element's own request for overlapping bytes — the combination reliably hung rather than merely being slow.

**Fix:** Removed the manual prefetch entirely. `seekTo()` now computes the clamped target time and sets `audio.currentTime` directly, relying on the fact that the AAC renditions are encoded with `-movflags +faststart` (see [ADR-0002](../adr/0002-multi-bitrate-aac-renditions.md)), which lets the browser perform true random-access `Range`-based seeking on its own — fetching only the bytes actually needed near the target, the same mechanism a production player like Spotify or YouTube Music relies on. `onSeeking`/`onSeeked` handlers were added to show/clear the buffering spinner during whatever brief fetch the native seek requires. Full writeup: [ADR-0004](../adr/0004-native-range-based-seeking.md).

Verification for this fix relied on `tsc --noEmit`, nginx access-log inspection (confirming only one small request fires per seek rather than a multi-megabyte prefix), and a `curl` timing test proving the server serves arbitrary mid-file ranges quickly (88ms TTFB for a 64KB chunk at the 40% offset of a 7.6MB file) — not literal audio playback, for the reason described below.

---

## Bandwidth probe under-selected quality on genuinely fast connections

**Symptom:** Even under Fast 4G throttling, the initial quality pick was consistently low/normal instead of very-high, and the same behavior was observed regardless of whether the throttle profile was Fast 4G, Slow 4G, or 3G — suggesting the probe wasn't distinguishing between them correctly.

**Root cause:** `probeThroughputBytesPerSecond()` timed a single 128 KB ranged `fetch()` and used the elapsed time directly to compute bytes/sec. For a small sample, that elapsed time includes one-time connection setup cost (DNS, TLS handshake, TCP slow-start) — which dominates the timing when the probe is the first request made to the origin in a session, making even a fast connection measure as slow.

**Fix:** Added a small (16 KB) warm-up `fetch()` against the same URL, discarded entirely, before starting the timer for the real 128 KB timed sample (now read from a shifted byte offset so it doesn't overlap the warm-up bytes). This costs one extra small request per quality decision but measures sustained throughput on an already-open connection rather than paying for handshake overhead inside the timed window. See the "Update" section of [ADR-0003](../adr/0003-client-side-throughput-probing.md).

---

## Service worker blocked the entire stream response on its own background cache write

**Symptom:** Once the server-side chunk cap below was in place, the very first chunk of a stream still didn't reach the `<audio>` element until an unexpectedly long delay, disproportionate to the chunk's now-small size.

**Root cause:** `stream-cache-worker.js`'s `handleStreamRange()` ran `await cachePrefix(request.url, response.clone())` before returning the response to the page. `cachePrefix` calls `response.arrayBuffer()` on the cloned response, which only resolves once the *entire* body has been read — so the `await` held up every byte of the real response until the service worker had independently finished downloading the same data a second time in the background. Before the server capped response sizes (see [`server-issues.md`](server-issues.md#a-single-stream-request-downloaded-the-entire-track-regardless-of-network-conditions)), this meant playback couldn't start until the entire remaining file had silently downloaded once already.

**Fix:** Changed `handleStreamRange` to accept the `FetchEvent` and call `event.waitUntil(cachePrefix(...))` instead of awaiting it inline, so the real response streams to the page as soon as it's available and the cache write runs in the background without blocking anything. See [ADR-0007](../adr/0007-server-side-capped-byte-range-chunking.md).

---

## No app-wide block when the browser goes offline

**Symptom:** Going offline mid-session only affected the currently-loaded track (a small tooltip icon on the mini-player, and playback pausing once it reached the edge of already-buffered audio) — there was no indication elsewhere in the app that the network was down, and refreshing the page while offline showed no indication at all until some other action failed.

**Root cause:** The only offline handling lived inside `MusicPlayer.tsx`, reacting to `window`'s `online`/`offline` events. Nothing checked `navigator.onLine` outside the player, and nothing checked it synchronously on load — so a fresh page load while offline had no signal to react to until the next `offline` event fired, which never happens if the page loaded already offline.

**Fix:** Added `OfflineGuard.tsx`, a full-screen non-dismissible overlay mounted once near the root of `App.tsx`. Its `isOnline` state initializes directly from `navigator.onLine` (so a refresh while offline shows the guard immediately, not just after a subsequent state change) and updates only via the `online`/`offline` events, clearing the moment `online` fires. The player's own inline buffered-playback handling (pausing at the edge of what's downloaded, blocking seeks past it) was left in place underneath, since it only ever matters once the guard has already been dismissed by reconnecting.

---

## Possible self-inflicted quality downgrades from the periodic re-probe

**Symptom:** During one manual test session, a single track's quality was observed stepping down through every tier over about 90 seconds of continuous playback (`very_high` → `high` → `normal` → `low`), with no manual interaction and on a network that had no independent reason to be degrading. The gaps between downgrades (~24s, then ~17s) were suspiciously close to `UPGRADE_CHECK_INTERVAL_MS` (25s).

**Hypothesis, not confirmed:** `maybeUpgradeQuality()` runs every 25 seconds while playing and, whenever a higher tier than the current one exists, performs its own throughput probe (a warm-up fetch plus a timed fetch, both against the lowest-bitrate rendition) concurrently with the actively-streaming playback request. On a constrained connection (or a busy local Docker network, as in this test), that probe traffic competing for the same limited bandwidth/connection pool could itself be enough to stall the primary stream — which `handleWaiting()` counts toward its "two stalls within 20 seconds triggers a downgrade" rule. If so, the periodic health-check would be periodically causing the exact symptom it exists to detect and recover from, and each downgrade would make the next periodic probe's relative bandwidth cost larger (since the primary stream's own bitrate just dropped), which would explain the shrinking interval between downgrades (~24s, then ~17s) rather than a steady 25s cadence.

**Status:** Flagged, likely not the actual cause — weakened by a later manual test. A separate session deliberately reproduced the concurrent-probe condition this hypothesis depends on: a track settled on `normal` under a 3G throttle, and the periodic re-probe's warmup+measurement fetches were observed firing *while* a `normal`-quality playback chunk request was still in flight (visible as overlapping timestamps in the server access log). That concurrency caused no stall and no downgrade — instead, the throttle was switched to Fast 4G mid-probe and the player upgraded cleanly to `very_high` within about 2 seconds, with the only side effect being an expected `499` (the in-flight old-quality request being aborted when `audio.src` was swapped — see the note in [`server-issues.md`](server-issues.md#499-responses-during-a-quality-switch-are-expected)). This doesn't fully disprove the hypothesis (that test involved an *improving* connection, not a constant/degrading one, and this project's browser-automation tooling still can't play audio to run a fully controlled A/B test — see below), but it directly contradicts the "concurrent probe traffic destabilizes playback" mechanism the hypothesis relied on. The original cascade's cause remains unexplained; a genuine transient stall (e.g. host I/O contention — the original log had a MongoDB checkpoint line at the same time as the first downgrade) is now the more likely explanation. If this resurfaces, capture `onWaiting` timestamps directly rather than inferring stalls from request timing.

---

## Automated browser tooling cannot play audio

Not a bug in the app itself, but worth recording since it shaped how several of the fixes above were verified: the Claude-in-Chrome browser automation tooling used during development cannot fetch or decode `<audio>`/`<video>` sources at all. This was confirmed twice, independent of any app code — a manually created `<audio>` element pointed at a real stream URL never advanced past `readyState: 0` and `.play()` hung the automation's JS execution entirely; a trivial embedded silent WAV `data:` URI (zero network involved) hung identically. Streaming and seeking fixes made during this project were therefore verified through `fetch()`-based probes, `curl` timing tests, and server/nginx access-log inspection instead of literal in-browser playback, and should be spot-checked in a real browser after any further player changes.
