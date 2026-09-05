import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export interface YoutubeVideoMetadata {
  id: string;
  title?: string;
  uploader?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
}

export interface DownloadedThumbnail {
  path: string;
  contentType: string;
  extension: string;
  sizeBytes: number;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Only these hosts are accepted, even though yt-dlp itself supports thousands
 * of sites: the app is scoped to importing YouTube audio the operator is
 * authorized to use, not to acting as a general-purpose downloader.
 */
const ALLOWED_HOSTNAMES = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

const BLOCKED_AVAILABILITY = new Set(['private', 'needs_auth', 'premium_only', 'subscriber_only']);
const ACCEPTED_THUMBNAIL_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DURATION_SECONDS = 2 * 60 * 60;

@Injectable()
export class YoutubeImportService {
  private readonly logger = new Logger(YoutubeImportService.name);
  private readonly ytDlpPath: string;

  constructor(config: ConfigService) {
    this.ytDlpPath = config.get<string>('ytDlp.path') ?? 'yt-dlp';
  }

  assertAllowedUrl(rawUrl: string): void {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BadRequestException(`Enter a valid YouTube video URL (invalid: ${rawUrl})`);
    }
    if (!ALLOWED_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
      throw new BadRequestException(`Only youtube.com and youtu.be links are supported (rejected: ${rawUrl})`);
    }
  }

  async fetchMetadata(rawUrl: string): Promise<YoutubeVideoMetadata> {
    this.assertAllowedUrl(rawUrl);

    const result = await this.runYtDlp(['-j', '--no-playlist', '--no-warnings', rawUrl]);
    if (result.exitCode !== 0) {
      throw new BadRequestException(`Could not read this YouTube video: ${this.firstLine(result.stderr)}`);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    } catch {
      throw new InternalServerErrorException('Unexpected response while reading YouTube video metadata');
    }

    const extractor = String(parsed.extractor_key ?? parsed.extractor ?? '').toLowerCase();
    if (!extractor.includes('youtube')) {
      throw new BadRequestException('This link did not resolve to a YouTube video');
    }
    if (parsed.is_live) {
      throw new BadRequestException('Live streams cannot be imported');
    }

    const availability = typeof parsed.availability === 'string' ? parsed.availability : undefined;
    if (availability && BLOCKED_AVAILABILITY.has(availability)) {
      throw new BadRequestException('This video is not publicly available to download');
    }

    const durationSeconds = typeof parsed.duration === 'number' ? parsed.duration : undefined;
    if (durationSeconds && durationSeconds > MAX_DURATION_SECONDS) {
      throw new BadRequestException('Videos longer than 2 hours are not supported for import');
    }

    return {
      id: String(parsed.id ?? ''),
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      uploader: typeof parsed.uploader === 'string' ? parsed.uploader : undefined,
      durationSeconds,
      thumbnailUrl: typeof parsed.thumbnail === 'string' ? parsed.thumbnail : undefined,
    };
  }

  async downloadAudio(rawUrl: string, destinationDir: string): Promise<string> {
    this.assertAllowedUrl(rawUrl);

    const outputTemplate = join(destinationDir, 'source-audio.%(ext)s');
    const result = await this.runYtDlp([
      '-f',
      'bestaudio/best',
      '--no-playlist',
      '--no-warnings',
      '--max-filesize',
      '2G',
      '--socket-timeout',
      '30',
      '-o',
      outputTemplate,
      rawUrl,
    ]);

    if (result.exitCode !== 0) {
      throw new InternalServerErrorException(`yt-dlp failed to download audio: ${this.firstLine(result.stderr)}`);
    }

    const files = await readdir(destinationDir);
    const downloaded = files.find((name) => name.startsWith('source-audio.'));
    if (!downloaded) {
      throw new InternalServerErrorException('yt-dlp reported success but no audio file was found');
    }
    return join(destinationDir, downloaded);
  }

  /**
   * Best-effort only: a failed or missing thumbnail is not fatal to an
   * import, callers fall back to the app's existing default cover artwork.
   */
  async downloadThumbnail(
    thumbnailUrl: string | undefined,
    destinationPathWithoutExtension: string,
  ): Promise<DownloadedThumbnail | null> {
    if (!thumbnailUrl) {
      return null;
    }

    try {
      const parsed = new URL(thumbnailUrl);
      if (parsed.protocol !== 'https:') {
        return null;
      }

      const response = await fetch(thumbnailUrl);
      if (!response.ok || !response.body) {
        return null;
      }

      const contentType = (response.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim();
      if (!ACCEPTED_THUMBNAIL_TYPES.has(contentType)) {
        return null;
      }
      const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';

      const path = `${destinationPathWithoutExtension}.${extension}`;
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(path));
      const fileStat = await stat(path);

      return { path, contentType, extension, sizeBytes: fileStat.size };
    } catch (error) {
      this.logger.warn(
        `Thumbnail download failed, falling back to a default cover: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  private runYtDlp(args: readonly string[]): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.ytDlpPath, [...args], { shell: false });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
      });
    });
  }

  private firstLine(text: string): string {
    return text.split('\n').find((line) => line.trim().length > 0)?.trim() ?? 'Unknown error';
  }
}
