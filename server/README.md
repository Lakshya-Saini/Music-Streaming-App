# Music Streaming Server

NestJS backend for ingesting WAV masters, generating AAC delivery files, storing audio bytes in S3, and storing catalog metadata in MongoDB.

## Architecture

```text
POST /api/v1/tracks/upload-session
     ↓
NestJS creates track + presigned S3 PUT URL
     ↓
browser uploads WAV directly to S3
     ↓
POST /api/v1/tracks/:id/process
     ↓
NestJS downloads source WAV from S3 to temp disk
     ↓
ffprobe source validation
     ↓
FFmpeg AAC encoding
     ↓
64 / 128 / 256 / 320 kbps M4A assets
     ↓
ffprobe + decode validation
     ↓
S3 delivery uploads
     ↓
MongoDB track + audio asset records
     ↓
READY
```

The source upload no longer passes through the NestJS server. The browser uploads the master WAV directly to S3 using a short-lived presigned PUT URL, then the backend synchronously downloads that private source object for ffprobe and FFmpeg processing. The processing request is still synchronous for now because early uploads are expected to be low volume. The services are separated so the FFmpeg work can later move into a queue worker without rewriting the controller or persistence model.

## End-to-End Flow

```text
User opens /upload
      ↓
React collects metadata + WAV file details
      ↓
POST /api/v1/tracks/upload-session
      ↓
NestJS validates title, artist, fileName, contentType, sizeBytes
      ↓
MongoDB track is created with status=UPLOADING
      ↓
NestJS signs S3 PUT URL for music/tracks/<trackId>/master/source.wav
      ↓
React uploads WAV directly to S3 with PUT
      ↓
POST /api/v1/tracks/<trackId>/process
      ↓
NestJS HEADs the source object to verify upload metadata
      ↓
NestJS downloads the private source WAV to server/temp/<trackId>/source.wav
      ↓
ffprobe validates that the bytes are actually WAV/PCM audio
      ↓
FFmpeg creates AAC-LC M4A renditions: 64k, 128k, 256k, 320k
      ↓
ffprobe + FFmpeg decode validation check each rendition
      ↓
NestJS uploads each rendition to S3 under audio/v1
      ↓
MongoDB audioassets are created
      ↓
Track status becomes READY
      ↓
React landing page fetches GET /api/v1/tracks?status=READY
      ↓
User clicks a song
      ↓
HTML audio requests GET /api/v1/tracks/<trackId>/stream?quality=auto&network=<profile>
      ↓
NestJS selects a rendition and forwards the browser's Range header to S3
      ↓
NestJS streams the selected M4A bytes back with 200/206 media headers
```

## Requirements

- Node.js 20 or newer
- MongoDB
- FFmpeg and ffprobe available on `PATH`
- Private AWS S3 bucket

Install FFmpeg on macOS:

```bash
brew install ffmpeg
```

## Setup

```bash
cd server
npm install
cp .env.example .env
npm run start:dev
```

Set these environment variables:

```text
PORT=3000
MONGODB_URI=mongodb://localhost:27017/music-streaming
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-private-bucket-name
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REQUIRE_EXPLICIT_CREDENTIALS=true
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
MAX_UPLOAD_SIZE_MB=500
CLIENT_ORIGIN=http://localhost:5173
```

`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are required for local Docker Compose unless you mount/configure another AWS credential provider. They remain optional for real AWS deployments that use IAM roles; set `AWS_REQUIRE_EXPLICIT_CREDENTIALS=false` in that case. The bucket should remain private; the API stores object keys, not public URLs.

## Upload A Track

Step 1: create a track and direct-upload session.

```bash
curl -X POST http://localhost:3000/api/v1/tracks/upload-session \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Test Song",
    "artist": "Test Artist",
    "album": "Test Album",
    "genre": "Rock",
    "releaseYear": 2026,
    "trackNumber": 1,
    "fileName": "sample.wav",
    "contentType": "audio/wav",
    "sizeBytes": 52920314
  }'
```

Step 2: upload the WAV directly to S3 using the returned URL.

```bash
curl -X PUT "<upload.url from step 1>" \
  -H "Content-Type: audio/wav" \
  --upload-file sample.wav
```

Step 3: trigger backend processing.

```bash
curl -X POST http://localhost:3000/api/v1/tracks/<trackId>/process
```

Only WAV uploads are accepted. The session endpoint checks filename, MIME type, and declared size before issuing a URL. The processing endpoint downloads the S3 object and uses ffprobe as the real validation step because filenames and MIME types can be wrong.

Example response:

```json
{
  "id": "67f123...",
  "title": "My Test Song",
  "artist": "Test Artist",
  "album": "Test Album",
  "genre": "Rock",
  "durationMs": 300000,
  "status": "READY",
  "activeAudioVersion": 1,
  "source": {
    "codec": "pcm_s16le",
    "container": "wav",
    "sampleRate": 44100,
    "channels": 2,
    "bitDepth": 16,
    "sizeBytes": 52920314,
    "objectKey": "music/tracks/67f123/master/source.wav"
  },
  "audioAssets": [
    {
      "quality": "low",
      "bitrate": 64000,
      "codec": "aac",
      "container": "m4a",
      "objectKey": "music/tracks/67f123/audio/v1/aac-64.m4a"
    }
  ]
}
```

## Read APIs

```bash
curl "http://localhost:3000/api/v1/tracks?page=1&limit=20"
curl "http://localhost:3000/api/v1/tracks?artist=Test%20Artist&status=READY"
curl "http://localhost:3000/api/v1/tracks/<trackId>"
```

The list endpoint supports `artist`, `album`, `genre`, `status`, `page`, and `limit`.

## Streaming APIs

### List playable tracks

```http
GET /api/v1/tracks?status=READY&limit=100
```

The response includes track metadata, current-version audio assets, and a relative `streamUrl`.

```json
{
  "data": [
    {
      "id": "68ad...",
      "title": "My Test Song",
      "artist": "Test Artist",
      "durationMs": 300000,
      "status": "READY",
      "activeAudioVersion": 1,
      "audioAssets": [
        {
          "quality": "low",
          "bitrate": 64000,
          "container": "m4a",
          "objectKey": "music/tracks/68ad.../audio/v1/aac-64.m4a"
        }
      ],
      "streamUrl": "/api/v1/tracks/68ad.../stream?quality=auto"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 1,
    "totalPages": 1
  }
}
```

### Stream a track

```http
GET /api/v1/tracks/:id/stream?quality=auto&network=4g
```

This endpoint validates the track is READY, selects one generated S3 asset, forwards the browser `Range` header to S3, and streams the response back to the browser.

When the browser requests a byte range, NestJS returns `206 Partial Content` with `Content-Range`, `Content-Length`, and `Accept-Ranges`. This is what makes scrubbing and arrow-key seeking work reliably.

Supported `quality` values:

```text
auto
low
normal
high
very_high
```

Supported `network` values:

```text
slow-2g -> 64 kbps
2g      -> 64 kbps
3g      -> 128 kbps
4g      -> 320 kbps
unknown -> 128 kbps
```

This is adaptive selection, not full adaptive bitrate streaming. The first streaming version chooses the best file before playback starts based on the browser's reported network profile. True mid-song adaptation should use HLS or DASH later.

## Streaming Flow

```text
React player
  |
  | audio.src = /api/v1/tracks/<id>/stream?quality=auto&network=4g
  v
NestJS stream endpoint
  |
  | find READY track + audioassets
  | select bitrate
  | forward Range header to S3 GetObject
  v
S3 private object response
  |
  | NestJS copies media headers and pipes bytes
  v
HTMLAudioElement
  |
  | progress/timeupdate events
  v
UI shows playback position + contiguous loaded percentage
```

## Why Proxy Range Requests For Now

NestJS currently proxies the selected M4A stream so it can preserve normal browser media semantics during seeking. Browsers often issue `Range: bytes=...` requests when users scrub, press arrow keys, or jump forward. The server forwards that range to S3 and returns S3's partial response to the browser. The UI displays the contiguous loaded range from the beginning of the song so `Loaded 40%` means the first 40% should remain playable from browser buffer, even when the user jumps back or loses connection.

This is easy to understand and works well for early development, but it means audio bytes pass through the API server. Later, CloudFront can replace this path with signed URLs or signed cookies so S3/CloudFront serves bytes directly while preserving HTTP Range playback.

## Docker Compose

From the project root:

```bash
docker compose build
docker compose up
```

This builds the React client, NestJS server, and starts MongoDB. Set `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` in your shell or a root `.env` file before using upload/processing endpoints.

The client is served on:

```text
http://localhost:5173
```

The server API is served on:

```text
http://localhost:3000/api/v1
```

Your S3 bucket also needs CORS rules that allow the browser origin to PUT WAV objects using presigned URLs. Keep the bucket private; presigned upload URLs grant temporary write access to one object key.

Example S3 bucket CORS configuration for local development:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": ["http://localhost:5173"],
    "ExposeHeaders": ["ETag", "Accept-Ranges", "Content-Range", "Content-Length"],
    "MaxAgeSeconds": 3000
  }
]
```

In AWS Console, open the S3 bucket, go to **Permissions**, then **Cross-origin resource sharing (CORS)** and paste the JSON above. `PUT` is needed for direct browser upload. `GET` and `HEAD` are useful for later direct-S3 or CloudFront playback. The current NestJS stream endpoint proxies media bytes, so playback itself is governed by API CORS, but keeping S3 CORS ready makes later direct delivery easier.

## S3 Layout

```text
music/
└── tracks/
    └── <trackId>/
        ├── master/
        │   └── source.wav
        └── audio/
            └── v1/
                ├── aac-64.m4a
                ├── aac-128.m4a
                ├── aac-256.m4a
                └── aac-320.m4a
```

The master WAV is preserved because it is the canonical upload and can support future retries or higher-quality encodes. Delivery keys include `v1` because encoded assets are immutable; if the encoding strategy changes later, generate `v2` rather than overwriting old files.

## Encoding Choices

The current pipeline outputs AAC-LC in M4A/MP4 containers at 64, 128, 256, and 320 kbps. The first version normalizes output to 44.1 kHz stereo for predictable delivery behavior. This is simple and widely compatible; a future version could preserve higher sample rates or surround layouts when the player strategy supports them.

`-movflags +faststart` is used for every M4A so MP4 metadata is near the beginning of the file, helping clients start progressive playback sooner.

A 5-minute 128 kbps AAC file is approximately:

```text
128,000 bits/sec * 300 sec / 8 = 4.8 MB
```

The exact size varies because AAC encoding and container metadata are not perfectly fixed.

## MongoDB Overview

`tracks` stores catalog metadata, lifecycle status, source WAV metadata, source checksum, and the source S3 key.

`audioassets` stores one document per generated rendition: track ID, version, quality, bitrate, codec/container, duration, checksum, S3 key, and status.

Indexes support common filtering by track metadata and asset lookup by `trackId`, `trackId + version`, and `trackId + version + bitrate`. A basic MongoDB text index exists over `title`, `artist`, `album`, and `genre`; that is useful for simple learning-stage search, but it is not a replacement for OpenSearch or Elasticsearch.

## Failure Handling

The workflow is intentionally state-based rather than pretending MongoDB and S3 are one transaction. A track is playable only when `track.status === "READY"` and all current-version assets exist.

If processing fails:

- temporary local files are deleted
- the track is marked `FAILED`
- partial delivery renditions uploaded to S3 are deleted when possible
- the source WAV is preserved in S3 for future retry support

## Future Improvements

- SQS, Kafka, or RabbitMQ workers
- asynchronous transcoding
- CloudFront
- signed URLs
- CloudFront-backed direct HTTP Range playback
- HLS
- adaptive bitrate streaming
- audio waveform generation
- loudness analysis
- OpenSearch
- user uploads
- authentication
- rate limiting
