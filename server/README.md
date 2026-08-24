# Music Streaming Server

NestJS backend for ingesting WAV masters, generating AAC delivery files, storing audio bytes in S3, and storing catalog metadata in MongoDB.

## Architecture

```text
POST /api/v1/tracks
     ↓
NestJS multipart endpoint
     ↓
temporary WAV on disk
     ↓
ffprobe source validation
     ↓
S3 master upload
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

The request is processed synchronously for now because early uploads are expected to be low volume. The services are separated so the FFmpeg work can later move into a queue worker without rewriting the controller or persistence model.

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
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
MAX_UPLOAD_SIZE_MB=500
```

`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are optional when the app runs in an AWS environment with an IAM role. The bucket should remain private; the API stores object keys, not public URLs.

## Upload A Track

```bash
curl -X POST http://localhost:3000/api/v1/tracks \
  -F "file=@sample.wav" \
  -F "title=My Test Song" \
  -F "artist=Test Artist" \
  -F "album=Test Album" \
  -F "genre=Rock" \
  -F "releaseYear=2026" \
  -F "trackNumber=1"
```

Only WAV uploads are accepted. The server checks extension, MIME type, and ffprobe metadata; ffprobe is the important check because filenames and MIME types can be wrong.

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
- HTTP Range playback
- HLS
- adaptive bitrate streaming
- audio waveform generation
- loudness analysis
- OpenSearch
- user uploads
- authentication
- rate limiting
