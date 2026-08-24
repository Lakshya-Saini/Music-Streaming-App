import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { UploadTrackDto } from '../dto/upload-track.dto';
import { ListTracksQueryDto } from '../dto/list-tracks-query.dto';
import { AUDIO_VERSION } from '../constants/audio-renditions';
import { AudioAssetStatus, ProcessingStage, TrackStatus } from '../constants/track-status';
import { AudioProcessingService } from './audio-processing.service';
import { AudioStorageService } from './audio-storage.service';
import { Track, TrackDocument } from '../schemas/track.schema';
import { AudioAsset, AudioAssetDocument } from '../schemas/audio-asset.schema';
import { AudioMetadata, EncodedAudioResult } from '../interfaces/audio-metadata.interface';

export interface UploadedDiskFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class TracksService {
  private readonly logger = new Logger(TracksService.name);

  constructor(
    @InjectModel(Track.name) private readonly trackModel: Model<TrackDocument>,
    @InjectModel(AudioAsset.name) private readonly audioAssetModel: Model<AudioAssetDocument>,
    private readonly audioProcessing: AudioProcessingService,
    private readonly audioStorage: AudioStorageService,
    private readonly config: ConfigService,
  ) {}

  async createTrack(dto: UploadTrackDto, file?: UploadedDiskFile): Promise<Record<string, unknown>> {
    if (!file) {
      throw new BadRequestException('A WAV audio file is required');
    }

    const tempDir = dirname(file.path);

    try {
      this.assertWavUploadShape(file);
      this.assertUploadSize(file);
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true });
      throw error;
    }

    const track = await this.trackModel.create({
      ...dto,
      status: TrackStatus.UPLOADING,
      activeAudioVersion: AUDIO_VERSION,
    });

    const trackId = track._id.toString();
    const uploadedOutputKeys: string[] = [];

    this.logger.log(`Track upload started for ${trackId}`);

    try {
      const sourceMetadata = await this.runStage(
        ProcessingStage.PROBE_SOURCE,
        track,
        () => this.audioProcessing.probeAudio(file.path),
      );
      this.audioProcessing.validateSourceWav(sourceMetadata);
      this.logger.log(`ffprobe completed for track ${trackId}`);

      const sourceChecksum = await this.audioProcessing.calculateSha256(file.path);
      const sourceObjectKey = this.sourceObjectKey(trackId);

      await this.runStage(ProcessingStage.UPLOAD_SOURCE, track, async () => {
        await this.audioStorage.uploadFile({
          filePath: file.path,
          objectKey: sourceObjectKey,
          contentType: 'audio/wav',
          metadata: {
            checksumsha256: sourceChecksum,
            codec: sourceMetadata.codec,
          },
        });
      });
      this.logger.log(`Source uploaded for track ${trackId}`);

      await this.trackModel.updateOne(
        { _id: track._id },
        {
          $set: {
            status: TrackStatus.PROCESSING,
            durationMs: sourceMetadata.durationMs,
            source: {
              ...sourceMetadata,
              checksumSha256: sourceChecksum,
              objectKey: sourceObjectKey,
            },
          },
        },
      );

      const encodedResults: EncodedAudioResult[] = [];
      for (const rendition of this.audioProcessing.getRenditions()) {
        const outputPath = join(tempDir, rendition.outputFileName);
        const stage = `ENCODE_${rendition.label}` as ProcessingStage;
        encodedResults.push(
          await this.runStage(stage, track, () =>
            this.audioProcessing.encodeRendition(file.path, outputPath, rendition, trackId),
          ),
        );
      }

      for (const encoded of encodedResults) {
        const outputKey = this.renditionObjectKey(trackId, encoded.bitrate);
        await this.runStage(ProcessingStage.UPLOAD_OUTPUT, track, async () => {
          this.logger.log(`Uploading rendition to S3 for track ${trackId}: ${outputKey}`);
          await this.audioStorage.uploadFile({
            filePath: encoded.outputPath,
            objectKey: outputKey,
            contentType: 'audio/mp4',
            cacheControl: 'public, max-age=31536000, immutable',
            metadata: {
              checksumsha256: encoded.checksumSha256,
              bitrate: `${encoded.bitrate}`,
            },
          });
          uploadedOutputKeys.push(outputKey);
        });
      }

      const assets = await this.runStage(ProcessingStage.DATABASE, track, () =>
        this.audioAssetModel.insertMany(
          encodedResults.map((encoded) =>
            this.toAudioAssetDocument(track._id, trackId, encoded),
          ),
          { ordered: true },
        ),
      );

      /**
       * S3 and MongoDB are not one transaction. The READY flag is the durable
       * contract: clients should only treat a track as playable after every
       * current-version rendition has been uploaded and recorded.
       */
      const readyTrack = await this.trackModel.findByIdAndUpdate(
        track._id,
        { $set: { status: TrackStatus.READY }, $unset: { processingError: 1 } },
        { new: true },
      );

      if (!readyTrack) {
        throw new InternalServerErrorException('Track disappeared while processing');
      }

      this.logger.log(`Track processing completed for ${trackId}`);
      return this.toTrackResponse(readyTrack, assets);
    } catch (error) {
      await this.markFailed(track._id, error);

      /**
       * Preserve the source WAV in S3 after a failure. It is the expensive,
       * user-supplied master and can support a future retry. Delivery assets
       * are derived data, so uploaded partial renditions are deleted.
       */
      await this.cleanupUploadedRenditions(uploadedOutputKeys, trackId);
      this.logger.error(`Track processing failed for ${trackId}`, this.errorMessage(error));
      throw this.publicError(error);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      this.logger.log(`Temporary files cleaned up for track ${trackId}`);
    }
  }

  async listTracks(query: ListTracksQueryDto): Promise<Record<string, unknown>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const filter: Record<string, unknown> = {};

    for (const field of ['artist', 'album', 'genre', 'status'] as const) {
      if (query[field]) {
        filter[field] = query[field];
      }
    }

    const [data, total] = await Promise.all([
      this.trackModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.trackModel.countDocuments(filter).exec(),
    ]);

    return {
      data: data.map((track) => ({ ...track, id: track._id.toString(), _id: undefined })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTrack(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid track id');
    }

    const track = await this.trackModel.findById(id).exec();
    if (!track) {
      throw new NotFoundException('Track not found');
    }

    const assets = await this.audioAssetModel
      .find({ trackId: track._id })
      .sort({ version: 1, bitrate: 1 })
      .exec();

    return this.toTrackResponse(track, assets);
  }

  private assertWavUploadShape(file: UploadedDiskFile): void {
    const extension = basename(file.originalname).toLowerCase().split('.').pop();
    const acceptedMimeTypes = new Set(['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/vnd.wave']);
    if (extension !== 'wav' || !acceptedMimeTypes.has(file.mimetype)) {
      throw new BadRequestException('Only valid WAV audio files are supported');
    }
  }

  private assertUploadSize(file: UploadedDiskFile): void {
    const maxSizeMb = this.config.getOrThrow<number>('upload.maxSizeMb');
    const maxBytes = maxSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new PayloadTooLargeException(`File exceeds maximum upload size of ${maxSizeMb} MB`);
    }
  }

  private async runStage<T>(
    stage: ProcessingStage,
    track: TrackDocument,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      await this.trackModel.updateOne(
        { _id: track._id },
        {
          $set: {
            status: TrackStatus.FAILED,
            processingError: {
              stage,
              message: this.errorMessage(error),
            },
          },
        },
      );
      throw error;
    }
  }

  private toAudioAssetDocument(
    trackId: Types.ObjectId,
    trackIdString: string,
    encoded: EncodedAudioResult,
  ): Partial<AudioAsset> {
    const quality = encoded.quality as AudioAsset['quality'];
    return {
      trackId,
      version: AUDIO_VERSION,
      quality,
      codec: 'aac',
      codecProfile: 'LC',
      container: 'm4a',
      bitrate: encoded.bitrate,
      sampleRate: encoded.metadata.sampleRate,
      channels: encoded.metadata.channels,
      channelLayout: encoded.metadata.channelLayout,
      durationMs: encoded.metadata.durationMs,
      sizeBytes: encoded.metadata.sizeBytes,
      checksumSha256: encoded.checksumSha256,
      objectKey: this.renditionObjectKey(trackIdString, encoded.bitrate),
      status: AudioAssetStatus.READY,
    };
  }

  private sourceObjectKey(trackId: string): string {
    return `music/tracks/${trackId}/master/source.wav`;
  }

  private renditionObjectKey(trackId: string, bitrate: number): string {
    return `music/tracks/${trackId}/audio/v${AUDIO_VERSION}/aac-${bitrate / 1000}.m4a`;
  }

  private async cleanupUploadedRenditions(objectKeys: string[], trackId: string): Promise<void> {
    for (const objectKey of objectKeys) {
      try {
        await this.audioStorage.deleteFile(objectKey);
      } catch (error) {
        this.logger.warn(
          `Failed to delete partial rendition for track ${trackId}: ${objectKey}; ${this.errorMessage(error)}`,
        );
      }
    }
  }

  private async markFailed(trackId: Types.ObjectId, error: unknown): Promise<void> {
    await this.trackModel.updateOne(
      { _id: trackId },
      {
        $set: {
          status: TrackStatus.FAILED,
          processingError: {
            message: this.errorMessage(error),
          },
        },
      },
    );
  }

  private toTrackResponse(
    track: TrackDocument,
    assets: readonly AudioAssetDocument[],
  ): Record<string, unknown> {
    const raw = track.toObject();
    return {
      id: raw._id.toString(),
      title: raw.title,
      artist: raw.artist,
      album: raw.album,
      albumArtist: raw.albumArtist,
      genre: raw.genre,
      releaseYear: raw.releaseYear,
      trackNumber: raw.trackNumber,
      discNumber: raw.discNumber,
      composer: raw.composer,
      copyright: raw.copyright,
      language: raw.language,
      isrc: raw.isrc,
      durationMs: raw.durationMs,
      status: raw.status,
      activeAudioVersion: raw.activeAudioVersion,
      source: raw.source,
      processingError: raw.processingError,
      audioAssets: assets.map((asset) => {
        const assetRaw = asset.toObject();
        return {
          id: assetRaw._id.toString(),
          quality: assetRaw.quality,
          bitrate: assetRaw.bitrate,
          codec: assetRaw.codec,
          codecProfile: assetRaw.codecProfile,
          container: assetRaw.container,
          sampleRate: assetRaw.sampleRate,
          channels: assetRaw.channels,
          channelLayout: assetRaw.channelLayout,
          durationMs: assetRaw.durationMs,
          sizeBytes: assetRaw.sizeBytes,
          checksumSha256: assetRaw.checksumSha256,
          objectKey: assetRaw.objectKey,
          status: assetRaw.status,
        };
      }),
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  private publicError(error: unknown): Error {
    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException ||
      error instanceof InternalServerErrorException
    ) {
      return error;
    }
    return new InternalServerErrorException('Track processing failed');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown processing error';
  }
}
