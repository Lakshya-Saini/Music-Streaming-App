# Tech Stack — v1

## Client (`client/`)

| Layer | Choice | Version (see `package.json`) | Why |
|---|---|---|---|
| Build tool | Vite | ^6.0.7 | Fast dev server + HMR, simple config, first-class React plugin |
| UI framework | React | ^18.3.1 | Component model matches the app's page/row/card composition |
| Language | TypeScript | ^5.7.2 | Compile-time safety across the API contract (`types.ts` mirrors server DTOs) |
| Component library | MUI (`@mui/material`) | ^6.4.12 | Ready-made accessible primitives (`Slider`, `Menu`, `ToggleButtonGroup`, `LinearProgress`) used throughout the player and upload UI |
| Styling engine | Emotion (`@emotion/react`/`styled`) | ^11.14.x | MUI's underlying styling engine; also backs the custom `theme.ts` light/dark tokens |
| Routing | React Router | ^7.1.1 | Client-side routes: `/`, `/browse`, `/playlists`, `/upload` |
| Icons | `lucide-react` | ^0.468.0 | Icon set used across the player, upload stages, and nav |
| Custom CSS | `styles.css` + CSS variables (`--text`, `--accent`, etc.) | — | Theme tokens toggled via `document.documentElement.dataset.theme` |

No client-side state management library is used — a single `LibraryContext` (React Context + hooks) is sufficient for the app's scope (one shared track list, one active track, one search query).

## Server (`server/`)

| Layer | Choice | Version | Why |
|---|---|---|---|
| Framework | NestJS | ^10.4.20 | Opinionated module/controller/service/DTO structure; built-in DI, pipes, and config module fit a small but growing API |
| Language | TypeScript | ^5.9.2 | Shared discipline with the client; DTOs double as the API's input validation contract |
| Database | MongoDB via Mongoose (`@nestjs/mongoose`) | driver ^8.8.4 | Schema-flexible enough for embedded sub-documents (`SourceAudio`, `ImportSource`, etc.) without a migration system, while still giving indexes and validation |
| Config | `@nestjs/config` + Joi (`env.validation.ts`) | ^3.3.0 / ^17.13.3 | Fails fast on boot if required env vars (Mongo URI, AWS region/bucket, conditionally AWS keys) are missing or malformed |
| Object storage | AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) | ^3.864.0 | Presigned PUT URLs for direct browser→S3 upload; streamed `GetObject` with `Range` passthrough for playback; also targets any S3-compatible store |
| Validation | `class-validator` + `class-transformer` | ^0.14.2 / ^0.5.1 | Declarative DTO validation (`@IsString`, `@Matches` for ISRC/language tags, etc.) applied automatically by Nest's `ValidationPipe` |
| Audio transcoding | `ffmpeg` / `ffprobe` (external binaries, invoked via `node:child_process.spawn`) | image-installed via `apt-get` | Industry-standard, scriptable, and already the right tool for AAC-LC encoding, `+faststart` muxing, and stream probing; args are passed as an array (no shell) to avoid injection |
| YouTube import | `yt-dlp` (external binary, invoked via `spawn`) | pip-installed in the Docker image | Actively maintained YouTube extractor; used only for metadata (`-j`) and best-audio download, gated behind a host allow-list and an explicit authorization flag |

## Infrastructure

| Component | Choice | Why |
|---|---|---|
| Containerization | Docker + Docker Compose | Three services (`mongodb`, `server`, `client`) with a single `docker compose up`; matches the "small team, few environments" scale of this project |
| Client web server | Nginx (`nginx:1.27-alpine`) | Serves the Vite production build as static files and reverse-proxies `/api/*` to the server container, forwarding `Range`/`If-Range` headers needed for audio seeking |
| Database | MongoDB 7 (`mongo:7` image) | Document model fits the catalog's embedded, semi-structured metadata; no relational joins are needed at this scale |
| Object storage | Amazon S3 (or any S3-compatible bucket) | Durable, cheap storage for large binary audio/image assets, kept out of the database entirely; presigned URLs allow direct browser upload without proxying bytes through the API |
| Node runtime | Node 20 (`node:20-bookworm-slim`) | LTS at time of writing; same major version for both client build and server runtime images |

## Why not (yet)

These were consciously deferred rather than overlooked — see the corresponding ADRs for the reasoning:

- **HLS/DASH** — true segment-level adaptive bitrate streaming. Current ABR swaps whole renditions in place instead ([ADR-0002](adr/0002-multi-bitrate-aac-renditions.md)).
- **A queue/worker system** (SQS, BullMQ, etc.) — `/tracks/:id/process` and `/tracks/youtube-import` run synchronously in-request today; acceptable at current upload volume, but the pipeline is already isolated into standalone services so it can move behind a worker later without a rewrite ([ADR-0006](adr/0006-state-based-processing-pipeline.md)).
- **CloudFront / signed cookies** — audio bytes are proxied through the NestJS server rather than served directly from S3/CDN, which is simpler for local development and keeps object keys private, at the cost of API bandwidth.
- **Authentication** — none yet; every route is open. Out of scope for v1.
- **Full-text search service (OpenSearch/Elasticsearch)** — a basic MongoDB text index over `title`/`artist`/`album`/`genre` covers today's catalog size.
