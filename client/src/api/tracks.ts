import { authHeaders, getStoredToken } from './auth';
import { AudioAsset, Track } from '../types';

interface UploadSessionRequest {
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  language?: string;
  releaseYear?: number;
  trackNumber?: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

interface UploadSessionResponse {
  track: {
    id: string;
  };
  upload: {
    method: 'PUT';
    url: string;
    headers: Record<string, string>;
  };
}

export interface YoutubeImportRequest {
  url: string;
  authorizationConfirmed: boolean;
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  language?: string;
  releaseYear?: number;
}

export interface YoutubeImportResult {
  id: string;
  title: string;
  artist: string;
  status: string;
  coverUrl?: string;
}

interface CoverUploadSessionRequest {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

interface CoverUploadSessionResponse {
  upload: {
    method: 'PUT';
    url: string;
    headers: Record<string, string>;
  };
  coverUrl: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

interface ApiAudioAsset {
  id: string;
  quality: 'low' | 'normal' | 'high' | 'very_high';
  bitrate: number;
  sizeBytes: number;
  codec: string;
  container: string;
  objectKey: string;
  status: string;
}

interface ApiTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  language?: string;
  releaseYear?: number;
  durationMs?: number;
  audioAssets?: ApiAudioAsset[];
  streamUrl?: string;
  coverUrl?: string;
  createdAt?: string;
}

interface ListTracksResponse {
  data: ApiTrack[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const covers = [
  '/covers/aurora-drive.svg',
  '/covers/afterglow-room.svg',
  '/covers/midnight-ledger.svg',
  '/covers/paper-kites.svg',
  '/covers/coastline-static.svg',
];

const colors = ['#fa233b', '#ff7a00', '#af52de', '#007aff', '#34c759'];

export async function createUploadSession(
  payload: UploadSessionRequest,
): Promise<UploadSessionResponse> {
  const response = await fetch(`${API_BASE_URL}/tracks/upload-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<UploadSessionResponse>;
}

export async function listReadyTracks(): Promise<Track[]> {
  const response = await fetch(`${API_BASE_URL}/tracks?status=READY&limit=100`);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as ListTracksResponse;
  return payload.data.map((track, index) => mapApiTrack(track, index));
}

/**
 * The native <audio> element issues this request itself and cannot attach an
 * Authorization header, so the access token rides along as a query param
 * instead - the server's JwtAuthGuard accepts either form.
 */
function withStreamToken(url: string): string {
  const token = getStoredToken();
  return token ? `${url}&token=${encodeURIComponent(token)}` : url;
}

export function streamingUrlFor(trackId: string, network: string): string {
  return withStreamToken(
    `${API_BASE_URL}/tracks/${trackId}/stream?quality=auto&network=${encodeURIComponent(network)}`,
  );
}

/** Requests a specific rendition explicitly, bypassing the server's network-guess fallback entirely. */
export function streamingUrlForQuality(trackId: string, quality: AudioAsset['quality']): string {
  return withStreamToken(`${API_BASE_URL}/tracks/${trackId}/stream?quality=${encodeURIComponent(quality)}`);
}

export function uploadFileToS3(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);

    Object.entries(headers).forEach(([key, value]) => {
      request.setRequestHeader(key, value);
    });

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(
        new Error(
          `S3 upload failed with status ${request.status}. Check the bucket CORS policy, object permissions, and that the request Content-Type matches the presigned URL.`,
        ),
      );
    };

    request.onerror = () =>
      reject(
        new Error(
          'S3 upload failed before S3 returned a response. This is commonly caused by missing S3 CORS rules for http://localhost:5173.',
        ),
      );
    request.send(file);
  });
}

export async function processUploadedTrack(trackId: string): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}/tracks/${trackId}/process`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<unknown>;
}

export async function importYoutubeTrack(
  payload: YoutubeImportRequest,
): Promise<YoutubeImportResult> {
  const response = await fetch(`${API_BASE_URL}/tracks/youtube-import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<YoutubeImportResult>;
}

export async function createCoverUploadSession(
  trackId: string,
  payload: CoverUploadSessionRequest,
): Promise<CoverUploadSessionResponse> {
  const response = await fetch(`${API_BASE_URL}/tracks/${trackId}/cover-upload-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<CoverUploadSessionResponse>;
}

function mapApiTrack(track: ApiTrack, index: number): Track {
  const assets = track.audioAssets ?? [];
  const bestAsset = [...assets].sort((left, right) => right.bitrate - left.bitrate)[0];

  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album ?? 'Single',
    genre: track.genre ?? 'Music',
    language: track.language,
    year: track.releaseYear ?? new Date().getFullYear(),
    duration: Math.round((track.durationMs ?? 0) / 1000),
    bitrate: bestAsset ? Math.round(bestAsset.bitrate / 1000) : 0,
    cover: track.coverUrl ?? covers[index % covers.length],
    hasCustomCover: Boolean(track.coverUrl),
    color: colors[index % colors.length],
    streamUrl: streamingUrlFor(track.id, 'unknown'),
    createdAt: track.createdAt,
    audioAssets: assets,
  };
}
