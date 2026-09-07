/**
 * One-off CLI script that pushes local WAV masters through the same public
 * ingestion API the web client uses (POST /tracks/upload-session -> PUT to
 * the presigned S3 URL -> POST /tracks/:id/cover-upload-session -> PUT cover
 * -> POST /tracks/:id/process), so every track ends up with real S3-hosted
 * AAC renditions and a generated cover exactly like a normal admin upload.
 *
 * Cover art is generated locally with ffmpeg (gradients/geq/perlin lavfi
 * filters) rather than a stock image library, so no extra dependency is
 * required beyond the ffmpeg binary this project already needs.
 *
 * Usage:
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... \
 *     node scripts/upload-local-tracks.js ["/path/to/wav/folder"]
 *
 * Env vars:
 *   ADMIN_EMAIL / ADMIN_PASSWORD  required - admin credentials for /auth/login
 *   API_BASE_URL                  default http://localhost:<PORT>/api/v1
 *   FFMPEG_PATH                   default "ffmpeg"
 */
const path = require('node:path');
const os = require('node:os');
const { readdir, stat, readFile, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { generateCover } = require('./lib/generate-cover');
const { KNOWN_TRACKS, themeForUnknownFile } = require('./lib/track-catalog');

const FFMPEG_PATH = process.env.FFMPEG_PATH ?? 'ffmpeg';
const API_BASE_URL =
  process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3001'}/api/v1`;

async function apiFetch(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${method} ${pathname} -> ${response.status}: ${text}`);
  }
  return response.json();
}

async function putToS3(url, headers, buffer) {
  const response = await fetch(url, { method: 'PUT', headers, body: buffer });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`S3 PUT failed with ${response.status}: ${text}`);
  }
}

async function login() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Set ADMIN_EMAIL and ADMIN_PASSWORD env vars to an existing admin account before running this script.',
    );
  }
  const result = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
  return result.accessToken;
}

async function uploadTrack(token, filePath, meta, tempDir) {
  const fileName = path.basename(filePath);
  const fileStat = await stat(filePath);
  const fileBuffer = await readFile(filePath);

  console.log(`\n=> ${fileName}`);
  console.log(`   title="${meta.title}" artist="${meta.artist}" album="${meta.album}"`);

  const session = await apiFetch('/tracks/upload-session', {
    method: 'POST',
    token,
    body: {
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      albumArtist: meta.albumArtist,
      genre: meta.genre,
      releaseYear: meta.releaseYear,
      trackNumber: meta.trackNumber,
      language: meta.language,
      fileName,
      contentType: 'audio/wav',
      sizeBytes: fileStat.size,
    },
  });
  const trackId = session.track.id;
  console.log(`   track id: ${trackId}`);

  await putToS3(session.upload.url, session.upload.headers, fileBuffer);
  console.log('   uploaded source WAV to S3');

  const coverPath = path.join(tempDir, `${trackId}.jpg`);
  await generateCover(FFMPEG_PATH, coverPath, meta.theme);
  const coverBuffer = await readFile(coverPath);

  const coverSession = await apiFetch(`/tracks/${trackId}/cover-upload-session`, {
    method: 'POST',
    token,
    body: {
      fileName: 'cover.jpg',
      contentType: 'image/jpeg',
      sizeBytes: coverBuffer.length,
    },
  });
  await putToS3(coverSession.upload.url, coverSession.upload.headers, coverBuffer);
  console.log('   uploaded generated cover art to S3');

  console.log('   processing (server-side ffmpeg AAC encode + validation)...');
  const processed = await apiFetch(`/tracks/${trackId}/process`, { method: 'POST', token });
  console.log(
    `   done: status=${processed.status} renditions=${(processed.audioAssets ?? []).length} coverUrl=${processed.coverUrl}`,
  );

  return processed;
}

async function main() {
  const sourceDir = process.argv[2] ?? path.join(os.homedir(), 'Downloads', 'music files');
  console.log(`Source directory: ${sourceDir}`);
  console.log(`API base URL: ${API_BASE_URL}`);

  const entries = await readdir(sourceDir);
  const wavFiles = entries.filter((name) => name.toLowerCase().endsWith('.wav'));
  if (wavFiles.length === 0) {
    console.log('No .wav files found. Nothing to do.');
    return;
  }

  const token = await login();
  console.log(`Authenticated as admin.`);

  const tempDir = await mkdtemp(path.join(tmpdir(), 'cover-art-'));
  const results = [];
  try {
    for (const fileName of wavFiles) {
      const filePath = path.join(sourceDir, fileName);
      const meta = KNOWN_TRACKS[fileName] ?? themeForUnknownFile(fileName);
      try {
        const processed = await uploadTrack(token, filePath, meta, tempDir);
        results.push({ fileName, ok: true, title: processed.title, id: processed.id });
      } catch (error) {
        console.error(`   FAILED: ${error.message}`);
        results.push({ fileName, ok: false, error: error.message });
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  console.log('\nSummary:');
  for (const result of results) {
    console.log(
      result.ok
        ? `  ✔ ${result.fileName} -> "${result.title}" (${result.id})`
        : `  ✘ ${result.fileName} -> ${result.error}`,
    );
  }

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Fatal error:', error.message || error);
  process.exitCode = 1;
});
