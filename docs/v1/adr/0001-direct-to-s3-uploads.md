# ADR-0001: Direct-to-S3 browser uploads via presigned URLs

## Status

Accepted

## Context

The app needs to accept large audio master files (WAV, potentially hundreds of MB) from the browser. Routing that payload through the NestJS API before it reaches S3 would mean the API process holds the full file in memory or on local disk while relaying it, doubling bandwidth cost and making the API a bottleneck and single point of failure for every upload.

## Decision

The browser uploads the master WAV **directly to S3** using a short-lived presigned `PUT` URL:

1. `POST /tracks/upload-session` creates a `Track` document (`status: UPLOADING`) and returns a presigned S3 PUT URL scoped to one object key (`music/tracks/<id>/master/source.wav`), valid for 15 minutes.
2. The browser `PUT`s the file straight to S3 via `XMLHttpRequest` (for upload-progress events).
3. `POST /tracks/:id/process` tells the backend the upload is done; the backend then `HEAD`s the object to verify size/content-type before downloading it for transcoding.

The same pattern is reused for cover images (`POST /tracks/:id/cover-upload-session`).

## Consequences

- Upload bandwidth flows browser → S3 directly; the API server's bandwidth is only spent once, when it later downloads the source object for transcoding.
- The S3 bucket must allow the browser origin to `PUT` via CORS (see the root README and `AudioStorageService`), even though the bucket itself stays private — presigned URLs only grant temporary, scoped write access to one object key.
- The backend cannot fully trust client-declared `sizeBytes`/`contentType` from the upload-session request; `TracksService.assertUploadedSourceObject` re-validates against the actual `HEAD` response, and `AudioProcessingService.probeAudio`/`validateSourceWav` are the real gate (ffprobe output, not filename or MIME type).
- A failed or abandoned upload leaves an `UPLOADING` track with no corresponding S3 object; there is currently no garbage-collection job for these (acceptable at current scale, noted as a future improvement).
