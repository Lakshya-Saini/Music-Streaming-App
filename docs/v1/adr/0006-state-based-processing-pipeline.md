# ADR-0006: State-based (non-transactional) processing pipeline across MongoDB and S3

## Status

Accepted

## Context

Track processing (both direct-upload and YouTube-import pipelines) touches two independent systems that cannot share a transaction: MongoDB (catalog metadata, `AudioAsset` records) and S3 (source master, four encoded renditions, optional cover). The pipeline is also currently synchronous — it runs inline inside the HTTP request handling `/tracks/:id/process` or `/tracks/youtube-import` — rather than on a background worker, since expected upload volume is low at this stage of the project.

## Decision

Rather than attempting distributed-transaction semantics, correctness is defined by an explicit state machine on `Track.status` (`UPLOADING` → `PROCESSING` → `READY`, or `FAILED`), with a hard rule: **a track is only ever playable once `status === 'READY'`**, and that flag is set only after every rendition for the current `activeAudioVersion` has both been uploaded to S3 and recorded as an `AudioAsset` document.

Each pipeline stage is wrapped by `runStage()`, which on any failure marks the track `FAILED` with a `processingError.stage`/`message` before rethrowing. The `catch` block in both `processUploadedTrack` and `importFromYoutube` additionally deletes any renditions that were already uploaded to S3 during that attempt (`cleanupUploadedRenditions`), so a failed run never leaves a track in a state where some but not all renditions exist in S3 while status looks otherwise ambiguous. The original source WAV in S3 is deliberately *not* deleted on failure, since it's the one artifact needed to retry processing without re-uploading. A `finally` block always removes the local temp directory, regardless of success or failure.

The four-rendition encode-upload step is factored into one shared private method, `encodeUploadAndActivate`, used identically by both ingestion pipelines, so this consistency guarantee only has to be implemented and tested once.

## Consequences

- No possibility of a client seeing a track as `READY` with missing renditions, or streaming a partially-uploaded file — the status flag is the single source of truth clients rely on (`createStreamingResponse` also independently checks `status !== READY` and throws if assets are missing).
- Retrying a failed track is cheap: the source WAV is already in S3, so processing can be re-triggered without re-uploading the master.
- The pipeline is synchronous and single-attempt today — there is no automatic retry, and a request timeout or process crash mid-pipeline leaves the track `FAILED` (or, if the crash happens between S3 writes and the DB status update, potentially `PROCESSING` indefinitely) rather than resuming automatically. This is an accepted tradeoff for now; moving the pipeline behind a queue/worker (see [`TECH_STACK.md`](../TECH_STACK.md#why-not-yet)) would add resumability without changing this state-machine contract.
- `AudioAsset.version` exists specifically so this guarantee extends cleanly to future re-encodes: a new version's assets are inserted and only `activeAudioVersion` flips once the new version is fully `READY`, rather than mutating existing rendition documents in place.
