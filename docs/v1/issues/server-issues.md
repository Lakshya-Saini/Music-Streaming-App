# Server Issues — Found and Fixed

Issues discovered during development of the server, in the order they were addressed, with root cause and fix. File paths are relative to `server/` unless otherwise noted.

---

## MongoDB "language override unsupported: hi" on track insert

**Symptom:** Importing a specific YouTube video (a Hindi-language song) through the UI failed with a MongoDB error visible in the Docker logs: `language override unsupported: hi`.

**Root cause:** A text index already existed on the `tracks` collection (`title_text_artist_text_album_text_genre_text`) that was created *before* the schema specified `{ language_override: 'textIndexLanguage' }` as an option (see `src/modules/tracks/schemas/track.schema.ts`). Without that option, MongoDB's text index reads each document's own `language` field to decide which language's stemming/stopword rules to apply during indexing — and this app's `language` field holds a track's spoken-language tag (`hi`, `pa`, `en`, ...), not one of MongoDB's recognized text-search language names. Inserting a document with `language: 'hi'` against the old index configuration triggered the error. Mongoose's `autoIndex` does not automatically migrate or recreate an index whose options changed; it only creates indexes that don't yet exist, so the stale index kept being used even after the schema was updated.

**Fix:** Manually dropped the stale index and let it be recreated with the correct option:

```js
// via: docker exec <mongodb-container> mongosh
db.tracks.dropIndex('title_text_artist_text_album_text_genre_text')
```

then restarted the server so Mongoose's `autoIndex` recreated the index using the schema's `{ language_override: 'textIndexLanguage' }` option (pointing the index at an unused field name rather than the real `language` field, sidestepping the conflict). Verified via `db.tracks.getIndexes()` showing the corrected option, then successfully re-running the previously-failing import. See [`DB_SCHEMA.md`](../DB_SCHEMA.md#indexes-on-tracks) for the current, correct index definition.

**Takeaway:** a schema-level index option change is not automatically applied to an existing deployment by Mongoose — any future change to index definitions (not just this one) needs an explicit migration step (drop + recreate, or a versioned migration script) rather than relying on `autoIndex`.

---

## Docker Compose port/env mismatch for the server container

**Symptom:** Noticed while troubleshooting a separate connectivity issue: `docker-compose.yml` maps the server container's port as `"3001:3000"` (host `3001` → container `3000`) but also sets `environment: PORT: 3001`, meaning the Nest app actually listens on `3001` inside the container while the host-side mapping assumes it listens on `3000`.

**Status:** Flagged, not changed. The user-facing path (`http://localhost:5173` → Nginx in the `client` container → `server:3001` over the internal Docker network) works correctly regardless, since that request never goes through the host port mapping at all — it's a container-to-container connection using the port the app actually listens on. The mismatch would only matter for something connecting directly to `localhost:3001` on the host and expecting Nest's default assumptions to line up with the compose file's own port label. This was left as-is rather than silently "fixed," since it may reflect an intentional (if confusingly labeled) choice rather than an accident — worth a deliberate cleanup pass if the host-port mapping is ever relied upon directly.

---

## Transient 503 observed on the streaming endpoint

**Symptom:** During end-to-end network-throttling tests, the stream endpoint occasionally returned a `503` for a request that succeeded immediately on retry.

**Investigation:** The `stream-cache-worker.js` service worker was initially suspected, since an unexpected `x-stream-cache: hit` response header was observed around the same time. This was disproved directly: the service worker was unregistered mid-session (`navigator.serviceWorker.getRegistrations()` → `.unregister()`, plus `caches.delete()` to clear its Cache Storage entries) and the same `503` pattern was reproduced with the service worker completely absent, ruling it out as the cause.

**Status:** Root cause not conclusively identified — the failure was intermittent and non-blocking (every subsequent identical request succeeded), and the user-facing streaming problems it was found alongside were resolved by the throughput-probing and native-seeking fixes described in [`client-issues.md`](client-issues.md) and [ADR-0003](../adr/0003-client-side-throughput-probing.md)/[ADR-0004](../adr/0004-native-range-based-seeking.md). If this resurfaces, look first at the S3 SDK client's retry/connection-pool behavior under concurrent ranged `GetObject` calls (`AudioStorageService.getObjectStream`), since that's the one component in the request path that wasn't ruled out.

---

## A single stream request downloaded the entire track regardless of network conditions

**Symptom:** Across Fast 4G, Slow 4G, and 3G throttling profiles, playing a track produced only one `GET /tracks/:id/stream` request for the actual playback audio (separate from the throughput probe), and that request's `Content-Length` matched the whole rendition's size — several megabytes for a single response, even on a throttled connection where the adaptive-bitrate logic had correctly picked a lower-bitrate rendition.

**Root cause:** `TracksService.createStreamingResponse` forwarded the incoming `Range` header straight through to `AudioStorageService.getObjectStream`'s S3 `GetObjectCommand` unmodified. Browsers commonly request an open-ended range (`Range: bytes=0-`) for a media element, and S3 honors that literally — it returns everything from that byte to the end of the object in one `206` response. Nothing capped how much of the file a single request could return.

**Fix:** Added `TracksService.resolveStreamRange`, which clamps every request — bounded, open-ended, or missing a `Range` header entirely — to at most ~1/10th of the rendition's total size (clamped between 256 KB and 2 MB). The `<audio>` element already re-requests more data on its own once its buffer runs low relative to the `Content-Range` it received, so no client-side change was needed to make this segmented delivery actually happen. Full detail: [ADR-0007](../adr/0007-server-side-capped-byte-range-chunking.md).

**Verification:** Server access logs after the fix show many sequential `bytes=X-Y/total` requests advancing across a single play-through (e.g. `0-961129/9611297`, then `961130-1922259/9611297`, ...), spaced out over the course of playback rather than one log line per track.

---

## 499 responses during a quality switch are expected

Not a bug — recorded so a future reader doesn't mistake it for one, and doesn't conflate it with the unrelated transient-503 issue above. When the client switches rendition mid-playback (`switchToAsset()` in `MusicPlayer.tsx`, triggered by `maybeUpgradeQuality()` or `downgradeQuality()`), it sets `audio.src` to the new quality's URL while a chunk request for the *old* quality may still be in flight. The browser aborts that in-flight request as soon as the source changes, which nginx/the access log records as a `499` ("client closed request") with `0` bytes. This is the expected, harmless side effect of an in-place quality switch, not a server error or a dropped connection — it will reliably appear once per upgrade/downgrade and requires no handling.

---

## Docker-served client masking source changes during development

Not a server bug, but recorded here since it repeatedly caused confusion while iterating on server-adjacent behavior (stream headers, error responses) verified through the browser: `http://localhost:5173` resolves via IPv6 by default on this host, which was being served by the **Dockerized** Nginx client container running an older build, while a separately-running local Vite dev process (bound via IPv4) held the actual up-to-date code on what looked like the same URL. Any client-visible verification of a server change needs the Docker client image rebuilt and redeployed first:

```bash
docker compose build client && docker compose up -d client
```

This became a required step after every client-affecting change for the remainder of development.
