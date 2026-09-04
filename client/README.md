# Music Streaming Client

React UI for browsing uploaded songs, playing S3-backed renditions, switching theme mode, and uploading WAV masters through the direct-to-S3 flow.

## Pages

```text
/        Music library + player
/upload  Upload form + processing status
```

There is no authentication yet.

## App Flow

```text
Browser opens /
      ↓
GET http://localhost:3000/api/v1/tracks?status=READY&limit=100
      ↓
Client maps READY tracks into UI rows
      ↓
User selects a song
      ↓
Player detects network profile from navigator.connection.effectiveType
      ↓
audio.src = /api/v1/tracks/<trackId>/stream?quality=auto&network=<profile>
      ↓
NestJS proxies the selected S3 object with Range support
      ↓
Browser streams the selected M4A rendition from the API endpoint
      ↓
Player shows both playback position and contiguous loaded percent
```

## Upload Flow

```text
User opens /upload
      ↓
Selects WAV file and enters title/artist/album metadata
      ↓
POST /tracks/upload-session
      ↓
Client receives presigned S3 PUT URL
      ↓
Client PUTs the WAV directly to S3 with XMLHttpRequest
      ↓
Upload progress updates the status panel
      ↓
POST /tracks/<trackId>/process
      ↓
Backend validates WAV, creates AAC files, uploads renditions
      ↓
Track becomes READY
      ↓
The song appears on the landing page after refresh
```

## Streaming Details

The client does not receive permanent public S3 URLs. It asks the API to stream:

```text
GET /api/v1/tracks/<trackId>/stream?quality=auto&network=4g
```

The API chooses a rendition:

```text
slow-2g / 2g -> 64 kbps
3g           -> 128 kbps
4g           -> 320 kbps
unknown      -> 128 kbps
```

The API chooses the rendition, forwards browser range requests to S3, and returns `200 OK` or `206 Partial Content` with media headers. This supports scrubbing, arrow-key seeking, and normal HTML audio buffering.

This is not HLS yet. The selected file does not change mid-song. HLS can be added later for true adaptive bitrate switching while playback continues.

## Loaded Progress In The UI

The player listens to native audio events:

```text
loadedmetadata -> sets duration
progress       -> reads audio.buffered
canplay        -> refreshes buffered range
timeupdate     -> updates current playback time
ended          -> advances repeat/queue behavior
```

The progress bar has two layers:

```text
loaded layer = media downloaded continuously from the beginning of the song
slider thumb = where playback currently is
```

This makes streaming visible while keeping the offline promise honest. If the bar says `Loaded 40%`, the player only counts the contiguous range from `0s` to that point as loaded. A later range fetched after seeking, for example `75% -> 82%`, is playable while it remains in the browser buffer, but it does not increase the loaded percentage because there is still a gap before it.

When the user seeks forward, the client first preloads the skipped prefix through the same stream endpoint using an HTTP `Range` request. A service worker stores that prefix in the browser Cache API and can answer later audio range requests from the local cache. This means jumping to `40%` intentionally makes `0% -> 40%` locally available before the player lands at the new position.

## Configuration

Create `client/.env` when running locally without Docker:

```env
VITE_API_BASE_URL=/api/v1
```

With Docker Compose, nginx proxies `/api/*` from the client container to the server container. In local Vite development, `vite.config.ts` proxies `/api/*` to `http://localhost:3000`.

## Development

```bash
cd client
npm install
npm run dev
```

The app runs on:

```text
http://localhost:5173
```

## Production Build

```bash
npm run build
```

The Docker image builds the Vite app and serves static files with nginx.

## Important S3 Browser Requirement

Because the browser uploads directly to S3, the bucket must allow CORS for the client origin:

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

The bucket should still remain private. CORS only allows the browser to use valid presigned URLs; it does not make objects public.
