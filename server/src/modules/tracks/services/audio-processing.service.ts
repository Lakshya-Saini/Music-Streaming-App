import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {
  AUDIO_RENDITIONS,
  BITRATE_TOLERANCE_RATIO,
  OUTPUT_CHANNELS,
  OUTPUT_SAMPLE_RATE,
  AudioRenditionConfig,
} from '../constants/audio-renditions';
import { AudioMetadata, EncodedAudioResult } from '../interfaces/audio-metadata.interface';

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface FfprobeStream {
  codec_name?: string;
  codec_type?: string;
  profile?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  bits_per_sample?: number;
  bit_rate?: string;
  duration?: string;
}

interface FfprobeFormat {
  format_name?: string;
  duration?: string;
  bit_rate?: string;
  size?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

@Injectable()
export class AudioProcessingService {
  private readonly logger = new Logger(AudioProcessingService.name);
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;

  constructor(config: ConfigService) {
    this.ffmpegPath = config.getOrThrow<string>('ffmpeg.path');
    this.ffprobePath = config.getOrThrow<string>('ffmpeg.ffprobePath');
  }

  async probeAudio(filePath: string): Promise<AudioMetadata> {
    const result = await this.runProcess(this.ffprobePath, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    if (result.exitCode !== 0) {
      throw new BadRequestException('Audio file could not be parsed by ffprobe');
    }

    const parsed = JSON.parse(result.stdout) as FfprobeOutput;
    const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio');
    if (!audioStream || !parsed.format) {
      throw new BadRequestException('No audio stream was found in the uploaded file');
    }

    const fileStat = await stat(filePath);
    return {
      codec: audioStream.codec_name ?? 'unknown',
      container: this.primaryContainer(parsed.format.format_name),
      durationMs: this.secondsToMs(audioStream.duration ?? parsed.format.duration),
      sampleRate: Number(audioStream.sample_rate ?? 0),
      channels: audioStream.channels ?? 0,
      channelLayout: audioStream.channel_layout,
      bitDepth: audioStream.bits_per_sample,
      bitrate: this.optionalNumber(audioStream.bit_rate ?? parsed.format.bit_rate),
      sizeBytes: this.optionalNumber(parsed.format.size) ?? fileStat.size,
    };
  }

  validateSourceWav(metadata: AudioMetadata): void {
    const isWavContainer = metadata.container.includes('wav');
    const isPcmWav = metadata.codec.startsWith('pcm_');
    if (!isWavContainer || !isPcmWav) {
      throw new BadRequestException('Only valid WAV audio files are supported');
    }
  }

  async encodeRendition(
    inputPath: string,
    outputPath: string,
    rendition: AudioRenditionConfig,
    trackId: string,
  ): Promise<EncodedAudioResult> {
    this.logger.log(`Encoding ${rendition.label} kbps started for track ${trackId}`);

    /**
     * Arguments are passed as an array so user-controlled file names are never
     * interpolated into a shell command string.
     *
     * AAC is stored in M4A because it is an MP4-family container with broad
     * player support and room for timing metadata.
     */
    const result = await this.runProcess(this.ffmpegPath, [
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:a:0',
      '-vn',
      '-c:a',
      'aac',
      '-b:a',
      `${rendition.bitrate}`,
      '-ar',
      `${OUTPUT_SAMPLE_RATE}`,
      '-ac',
      `${OUTPUT_CHANNELS}`,
      /**
       * +faststart moves MP4/M4A `moov` metadata near the beginning:
       * ftyp -> mdat -> moov becomes ftyp -> moov -> mdat.
       * That helps progressive HTTP playback because players can read timing
       * and index information before downloading the whole file.
       */
      '-movflags',
      '+faststart',
      outputPath,
    ]);

    if (result.exitCode !== 0) {
      this.logger.error(`FFmpeg failed for track ${trackId}: ${result.stderr}`);
      throw new InternalServerErrorException(`Encoding ${rendition.label} kbps failed`);
    }

    const metadata = await this.probeAudio(outputPath);
    await this.validateEncodedRendition(inputPath, outputPath, metadata, rendition);
    await this.validateDecode(outputPath);
    const checksumSha256 = await this.calculateSha256(outputPath);

    this.logger.log(`Encoding ${rendition.label} kbps completed for track ${trackId}`);

    return {
      quality: rendition.quality,
      bitrate: rendition.bitrate,
      outputPath,
      metadata,
      checksumSha256,
    };
  }

  /**
   * Converts an arbitrary downloaded audio file (e.g. YouTube's bestaudio,
   * typically Opus/AAC in a WebM or M4A container) into the same PCM WAV
   * shape the direct-upload flow expects, so both flows can share one
   * probe/encode/validate pipeline downstream.
   */
  async transcodeToWav(inputPath: string, outputPath: string): Promise<void> {
    const result = await this.runProcess(this.ffmpegPath, [
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:a:0',
      '-vn',
      '-c:a',
      'pcm_s16le',
      '-ar',
      `${OUTPUT_SAMPLE_RATE}`,
      '-ac',
      `${OUTPUT_CHANNELS}`,
      outputPath,
    ]);

    if (result.exitCode !== 0) {
      this.logger.error(`FFmpeg WAV transcode failed: ${result.stderr}`);
      throw new InternalServerErrorException('Could not convert the downloaded audio into a WAV source file');
    }
  }

  async calculateSha256(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk: Buffer | string) => {
        hash.update(chunk);
      });
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  getRenditions(): readonly AudioRenditionConfig[] {
    return AUDIO_RENDITIONS;
  }

  private async validateEncodedRendition(
    sourcePath: string,
    outputPath: string,
    output: AudioMetadata,
    rendition: AudioRenditionConfig,
  ): Promise<void> {
    const source = await this.probeAudio(sourcePath);
    const outputStat = await stat(outputPath);
    const durationDeltaMs = Math.abs(output.durationMs - source.durationMs);
    const minimumBitrate = rendition.bitrate * (1 - BITRATE_TOLERANCE_RATIO);
    const maximumBitrate = rendition.bitrate * (1 + BITRATE_TOLERANCE_RATIO);

    if (outputStat.size <= 0) {
      throw new InternalServerErrorException('Encoded audio file is empty');
    }
    if (output.codec !== 'aac') {
      throw new InternalServerErrorException('Encoded audio is not AAC');
    }
    if (durationDeltaMs > 1500) {
      throw new InternalServerErrorException('Encoded audio duration differs from the source');
    }
    if (output.sampleRate !== OUTPUT_SAMPLE_RATE || output.channels !== OUTPUT_CHANNELS) {
      throw new InternalServerErrorException('Encoded audio shape does not match configured output');
    }
    if (output.bitrate && (output.bitrate < minimumBitrate || output.bitrate > maximumBitrate)) {
      throw new InternalServerErrorException('Encoded bitrate is outside the expected tolerance');
    }
  }

  private async validateDecode(outputPath: string): Promise<void> {
    const result = await this.runProcess(this.ffmpegPath, [
      '-v',
      'error',
      '-i',
      outputPath,
      '-f',
      'null',
      '-',
    ]);

    if (result.exitCode !== 0) {
      throw new InternalServerErrorException('Encoded audio failed decode validation');
    }
  }

  private runProcess(command: string, args: readonly string[]): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], { shell: false });
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

  private secondsToMs(value?: string): number {
    if (!value) {
      return 0;
    }
    return Math.round(Number(value) * 1000);
  }

  private optionalNumber(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private primaryContainer(formatName?: string): string {
    return formatName?.split(',')[0] ?? 'unknown';
  }
}
