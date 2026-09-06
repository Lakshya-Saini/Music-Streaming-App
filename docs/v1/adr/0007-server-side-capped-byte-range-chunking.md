# ADR-0007: Server-side capped byte-range chunking for segmented delivery

## Status

Accepted.

## Context

Testing across Fast 4G / Slow 4G / 3G throttling profiles found that a single track, once playing, produced only one visible request against `GET /tracks/:id/stream` for its actual playback data (separate from the throughput probe covered by [ADR-0003](0003-client-side-throughput-probing.md)) — and that request transferred the entire remaining file rather than a bounded slice of it. Network logs showed a `Content-Length` matching the full multi-megabyte rendition size for a single response.

The root cause was that `TracksController.streamTrack`/`TracksService.createStreamingResponse` forwarded whatever `Range` header the caller sent straight through to `AudioStorageService.getObjectStream`'s S3 `GetObjectCommand`, unmodified. Browsers commonly send an open-ended range (`Range: bytes=0-`) for a media element's initial request, and S3 honors that literally: it returns everything from that byte to the end of the object in one `206` response. Nothing in the request path ever asked for less than "the rest of the file."

This mattered for two reasons the user's testing called out directly: (1) bandwidth is wasted whenever a listener skips or stops partway through a track, since the whole file was already in flight regardless; and (2) it defeats mid-track adaptive bitrate switching, since there's no natural point at which the client is only committed to a small amount of data at the "wrong" quality.

Separately, `stream-cache-worker.js` (the service worker from [ADR-0004](0004-native-range-based-seeking.md)) made the effect of an unbounded response worse: on the first byte-0 request for a given URL, it ran `await cachePrefix(request.url, response.clone())` — which reads the cloned response's entire body into an `ArrayBuffer` — *before* returning the real response to the page. With an unbounded upstream response, this meant the `<audio>` element received zero bytes until the service worker had silently downloaded the *entire* file in the background first, effectively doubling the download and delaying playback start until a full download completed.

## Decision

1. **Cap every response server-side**, independent of what the caller's `Range` header requested. `TracksService.resolveStreamRange` divides each rendition into roughly `STREAM_CHUNK_PARTS` (10) equal pieces by size, clamped to a `MIN_STREAM_CHUNK_BYTES`/`MAX_STREAM_CHUNK_BYTES` window (256 KB – 2 MB) so very small or very large renditions still get a sane chunk size. Whatever the client asked for — an explicit bounded range, an open-ended `bytes=0-`, or no `Range` header at all — the response never exceeds one chunk, always as a `206 Partial Content` with an accurate `Content-Range` denominator so the client knows more data remains.
2. **Let the `<audio>` element re-request naturally.** No client-side timer decides when to fetch the "next part" — the media engine already does this on its own once it notices its buffer is running low relative to the declared `Content-Range`/`Accept-Ranges`, the same pull-based mechanism a segmented HLS/DASH stream relies on. This means the fix required no changes to `MusicPlayer.tsx`'s playback logic at all.
3. **Stop the service worker from blocking on its own cache write.** `handleStreamRange` now passes `event` through and calls `event.waitUntil(cachePrefix(...))` instead of `await cachePrefix(...)`, so the real response streams to the page immediately and the background cache write can take as long as it needs without holding up playback.

## Consequences

- A single stream request now transfers at most ~256 KB–2 MB (chunk-size-dependent on the rendition's total size), not the whole file — verified via server access logs showing sequential `bytes=X-Y/total` ranges advancing across many requests over the course of a play-through, spaced out roughly in proportion to how much audio each chunk represents at that bitrate, rather than one log line per track.
- Because the cap applies before the request ever reaches S3, this also bounds the amount of data pulled from S3 per request — relevant for egress cost, not just client bandwidth.
- The per-quality throughput probe from ADR-0003 already sends an explicit bounded `Range` (`bytes=0-131071`, plus the warm-up range added alongside this fix); `resolveStreamRange` honors an explicit end as long as it doesn't exceed the chunk cap, so probe behavior is unaffected by this change.
- A `206` is now returned even when the caller sent no `Range` header at all, which is a deliberate deviation from strict HTTP semantics (a bare `GET` "should" get a `200` with the full body) in favor of every response staying chunked; this is safe here because the only caller is this app's own `<audio>` element, which treats `206`/`Content-Range` as the signal to keep asking for more regardless of whether it sent a `Range` header itself.
- The service worker's cached "prefix" is now only ever one capped chunk (previously it could be the entire file, for any track small enough that its whole-file response still completed before being evicted/inspected), which shrinks its Cache Storage footprint correspondingly.