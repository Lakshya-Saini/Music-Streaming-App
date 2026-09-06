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

## Automated browser tooling cannot play audio

Not a bug in the app itself, but worth recording since it shaped how several of the fixes above were verified: the Claude-in-Chrome browser automation tooling used during development cannot fetch or decode `<audio>`/`<video>` sources at all. This was confirmed twice, independent of any app code — a manually created `<audio>` element pointed at a real stream URL never advanced past `readyState: 0` and `.play()` hung the automation's JS execution entirely; a trivial embedded silent WAV `data:` URI (zero network involved) hung identically. Streaming and seeking fixes made during this project were therefore verified through `fetch()`-based probes, `curl` timing tests, and server/nginx access-log inspection instead of literal in-browser playback, and should be spot-checked in a real browser after any further player changes.
