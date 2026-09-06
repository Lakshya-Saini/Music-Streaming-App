# Sonora

Sonora is a full-stack music streaming app: a React client for browsing and playing a music catalog, and a NestJS backend that ingests audio (direct WAV upload or YouTube import), transcodes it into multiple AAC bitrates, and streams it back with HTTP range support and connection-aware quality selection.

```
Browser  ──►  React + Vite client (Nginx in Docker)
                    │  /api/* proxied
                    ▼
             NestJS API  ──►  MongoDB (catalog metadata)
                    │
                    ▼
             S3-compatible object storage (source + encoded audio + covers)
```

See [`docs/v1/ARCHITECTURE.md`](docs/v1/ARCHITECTURE.md) for the full system diagram and request flows.

## Features

- **Catalog browsing** — home page with curated rows (Recently Uploaded, Trending, top genres), a browse page, and search.
- **Two ingestion paths**:
  - Direct WAV upload: browser uploads a master WAV straight to S3 via a presigned URL, then the backend transcodes it.
  - YouTube import: paste one or more YouTube links; the backend downloads audio via `yt-dlp`, transcodes it, and imports the thumbnail as cover art.
- **Multi-bitrate delivery** — every track is encoded into four AAC-LC renditions (64/128/256/320 kbps) with `+faststart` for fast progressive playback and true random-access seeking.
- **Adaptive playback** — the player measures real throughput (not `navigator.connection`) before starting a stream, picks the best affordable rendition, upgrades/downgrades in place as conditions change, and only starts streaming after Play is pressed.
- **HTTP range streaming** — the API forwards byte-range requests straight through to S3, so native browser seeking (forward and backward) works without any custom prefetching.

## Repository layout

```
client/   React + TypeScript + MUI single-page app (Vite)
server/   NestJS + MongoDB + S3 API
docs/v1/  Architecture, ADRs, DB schema, tech stack, and issue logs
```

## Prerequisites

- Node.js 20+
- Docker and Docker Compose (recommended path)
- An S3-compatible bucket (private) and credentials
- `ffmpeg` / `ffprobe` and `yt-dlp` on `PATH` if running the server outside Docker

## Quick start (Docker Compose)

1. Copy the server env file and fill in your AWS credentials/bucket:

   ```bash
   cp server/.env.example server/.env
   ```

2. From the repo root:

   ```bash
   docker compose build
   docker compose up -d
   ```

3. Open the app:

   ```
   http://localhost:5173
   ```

   The client container (Nginx) proxies `/api/*` to the server container internally, so no CORS configuration is needed between them.

Whenever you change client or server source, rebuild and redeploy that container:

```bash
docker compose build client && docker compose up -d client
docker compose build server && docker compose up -d server
```

## Quick start (local development, no Docker)

**MongoDB** — run your own instance, or start just the compose service:

```bash
docker compose up -d mongodb
```

**Server:**

```bash
cd server
npm install
cp .env.example .env   # set MONGODB_URI, AWS_*, etc.
npm run start:dev
```

**Client:**

```bash
cd client
npm install
npm run dev
```

The Vite dev server proxies `/api/*` to `http://localhost:3000` (see `client/vite.config.ts`); adjust `PORT` in `server/.env` accordingly, or update the proxy target.

## Environment variables

All server configuration lives in `server/.env` (see `server/.env.example`). Key variables:

| Variable | Purpose |
|---|---|
| `PORT` | Port the NestJS server listens on |
| `MONGODB_URI` | MongoDB connection string |
| `AWS_REGION`, `AWS_S3_BUCKET` | S3 bucket for source/encoded audio and covers |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Required for local Docker; optional when running with IAM roles (set `AWS_REQUIRE_EXPLICIT_CREDENTIALS=false`) |
| `FFMPEG_PATH`, `FFPROBE_PATH` | Paths to the ffmpeg/ffprobe binaries |
| `YT_DLP_PATH` | Path to the `yt-dlp` binary |
| `MAX_UPLOAD_SIZE_MB` | Max accepted source WAV size |
| `CLIENT_ORIGIN` | Allowed CORS origin |

The client only needs `VITE_API_BASE_URL` (see `client/.env.example`), which defaults to `/api/v1` (works with both the Nginx proxy and the Vite dev proxy).

Your S3 bucket must allow the browser to `PUT` directly using presigned URLs (direct upload and YouTube-imported cover flows both use presigned URLs server-side, so this is a same-origin API concern rather than a browser-to-S3 CORS concern for reads/streams — see [`docs/v1/ARCHITECTURE.md`](docs/v1/ARCHITECTURE.md) for the full picture). Keep the bucket private.

## Documentation

Detailed docs live under [`docs/v1/`](docs/v1/):

- [`ARCHITECTURE.md`](docs/v1/ARCHITECTURE.md) — system diagram, ingestion pipeline, and streaming/ABR flow
- [`TECH_STACK.md`](docs/v1/TECH_STACK.md) — languages, frameworks, and infrastructure, with rationale
- [`DB_SCHEMA.md`](docs/v1/DB_SCHEMA.md) — MongoDB collections, fields, and indexes
- [`adr/`](docs/v1/adr/) — architecture decision records
- [`issues/`](docs/v1/issues/) — issues found during development and how they were fixed, split by client/server
- [`deployment/`](docs/v1/deployment/) — AWS deployment options and a step-by-step guide for the recommended (lowest-cost, 24/7) setup

## License

Unlicensed / private project.
