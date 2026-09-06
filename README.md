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
- **Authentication** — browsing the catalog needs no account. Playing a track and the playlists page require sign-in: listeners sign in with Google (no password ever touches the app), while a single admin account (created via `server/scripts/seed-admin.js`, not through any UI) signs in with a password and is the only role that can reach the upload/import routes.

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

1. Copy the server env file and fill in your AWS credentials/bucket, a JWT secret, and your Google OAuth Client ID:

   ```bash
   cp server/.env.example server/.env
   ```

   Generate `JWT_SECRET` with `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`. For `GOOGLE_CLIENT_ID`, create an OAuth Client ID in [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → OAuth client ID → Web application, and add `http://localhost:5173` (and any real domain you'll deploy to) as an authorized JavaScript origin.

2. Copy the client env file and set the **same** Google Client ID, **and also** create a repo-root `.env` with it — Docker Compose reads build args from the repo root, not from `client/.env` (see [`docs/v1/issues/client-issues.md`](docs/v1/issues/client-issues.md#continue-with-google-button-showed-the-not-configured-placeholder-after-setting-vite_google_client_id) if this bites you later):

   ```bash
   cp client/.env.example client/.env
   # edit client/.env, then also:
   echo "VITE_GOOGLE_CLIENT_ID=<your client id>" > .env
   ```

3. From the repo root:

   ```bash
   docker compose build
   docker compose up -d
   ```

4. Create the admin account (both arguments are required; there can only ever be one admin — see [ADR-0008](docs/v1/adr/0008-google-oauth-users-password-admin.md)):

   ```bash
   cd server
   npm install   # first time only
   npm run seed:admin -- <your-email> <a-strong-password>
   cd ..
   ```

5. Open the app:

   ```
   http://localhost:5173
   ```

   The client container (Nginx) proxies `/api/*` to the server container internally, so no CORS configuration is needed between them. Sign in as the admin you just created (there's a "Sign in as admin instead" link under the Google button on `/login`) to see the Upload nav item; everyone else signs in with Google.

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
cp .env.example .env   # set MONGODB_URI, AWS_*, JWT_SECRET, GOOGLE_CLIENT_ID, etc.
npm run start:dev
npm run seed:admin -- <your-email> <a-strong-password>   # first time only, creates the one admin account
```

**Client:**

```bash
cd client
npm install
cp .env.example .env   # set VITE_GOOGLE_CLIENT_ID to the same client ID as the server
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
| `JWT_SECRET` | Signs/verifies the app's JWT; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |
| `JWT_EXPIRES_IN` | JWT lifetime (default `7d`) |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID, used to verify listeners' Google ID tokens server-side. Must match `VITE_GOOGLE_CLIENT_ID` on the client. Leave blank to disable Google sign-in (`/auth/google` then returns `503`) |

The client needs `VITE_API_BASE_URL` (see `client/.env.example`), which defaults to `/api/v1` (works with both the Nginx proxy and the Vite dev proxy), and `VITE_GOOGLE_CLIENT_ID`, the same Google Client ID as the server — required for the "Continue with Google" button to render. Both are Vite build-time values: when building via Docker, set `VITE_GOOGLE_CLIENT_ID` in a `.env` file at the **repo root** (read by `docker-compose.yml`'s build args), not just in `client/.env`.

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
