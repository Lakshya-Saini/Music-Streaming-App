import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { mkdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { InitiateTrackUploadDto } from '../dto/initiate-track-upload.dto';
import { ListTracksQueryDto } from '../dto/list-tracks-query.dto';
import { AUDIO_VERSION } from '../constants/audio-renditions';
import { AudioAssetStatus, ProcessingStage, TrackStatus } from '../constants/track-status';
import { AudioProcessingService } from './audio-processing.service';
import { AudioStorageService } from './audio-storage.service';
import { Track, TrackDocument } from '../schemas/track.schema';
import { AudioAsset, AudioAssetDocument } from '../schemas/audio-asset.schema';
import { EncodedAudioResult } from '../interfaces/audio-metadata.interface';

const PRESIGNED_UPLOAD_EXPIRES_SECONDS = 15 * 60;
const SOURCE_CONTENT_TYPE = 'audio/wav';

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

  async createUploadSession(dto: InitiateTrackUploadDto): Promise<Record<string, unknown>> {
    this.assertDirectUploadRequest(dto);

    const trackObjectId = new Types.ObjectId();
    const trackId = trackObjectId.toString();
    const sourceObjectKey = this.sourceObjectKey(trackId);
    const uploadUrlExpiresAt = new Date(Date.now() + PRESIGNED_UPLOAD_EXPIRES_SECONDS * 1000);

    const track = await this.trackModel.create({
      _id: trackObjectId,
      title: dto.title,
      artist: dto.artist,
      album: dto.album,
      albumArtist: dto.albumArtist,
      genre: dto.genre,
      releaseYear: dto.releaseYear,
      trackNumber: dto.trackNumber,
      discNumber: dto.discNumber,
      composer: dto.composer,
      copyright: dto.copyright,
      language: dto.language,
      isrc: dto.isrc,
      status: TrackStatus.UPLOADING,
      activeAudioVersion: AUDIO_VERSION,
      sourceUpload: {
        objectKey: sourceObjectKey,
        originalFileName: dto.fileName,
        contentType: SOURCE_CONTENT_TYPE,
        expectedSizeBytes: dto.sizeBytes,
        expectedChecksumSha256: dto.checksumSha256,
        uploadUrlExpiresAt,
      },
    });

    const uploadUrl = await this.audioStorage.createPresignedUploadUrl({
      objectKey: sourceObjectKey,
      contentType: SOURCE_CONTENT_TYPE,
      expiresInSeconds: PRESIGNED_UPLOAD_EXPIRES_SECONDS,
    });

    this.logger.log(`Created direct S3 upload session for track ${trackId}`);

    return {
      track: this.toTrackResponse(track, []),
      upload: {
        method: 'PUT',
        url: uploadUrl,
        objectKey: sourceObjectKey,
        expiresAt: uploadUrlExpiresAt,
        headers: {
          'Content-Type': SOURCE_CONTENT_TYPE,
        },
      },
      next: {
        method: 'POST',
        path: `/api/v1/tracks/${trackId}/process`,
      },
    };
  }

  async processUploadedTrack(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid track id');
    }

    const track = await this.trackModel.findById(id).exec();
    if (!track) {
      throw new NotFoundException('Track not found');
    }
    if (!track.sourceUpload) {
      throw new BadRequestException('Track does not have a pending source upload');
    }
    if (track.status === TrackStatus.READY) {
      const assets = await this.findAssets(track._id);
      return this.toTrackResponse(track, assets);
    }

    const trackId = track._id.toString();
    const tempDir = join(process.cwd(), 'temp', trackId);
    const sourcePath = join(tempDir, 'source.wav');
    const uploadedOutputKeys: string[] = [];

    this.logger.log(`Track processing started for ${trackId}`);

    try {
      await mkdir(tempDir, { recursive: true });

      const sourceObjectKey = track.sourceUpload.objectKey;
      const sourceInfo = await this.runStage(
        ProcessingStage.VERIFY_SOURCE_UPLOAD,
        track,
        () => this.audioStorage.getObjectInfo(sourceObjectKey),
      );
      this.assertUploadedSourceObject(track, sourceInfo.sizeBytes, sourceInfo.contentType);

      await this.runStage(ProcessingStage.DOWNLOAD_SOURCE, track, () =>
        this.audioStorage.downloadFile(sourceObjectKey, sourcePath),
      );
      this.logger.log(`Downloaded source from S3 for track ${trackId}`);

      const sourceMetadata = await this.runStage(
        ProcessingStage.PROBE_SOURCE,
        track,
        () => this.audioProcessing.probeAudio(sourcePath),
      );
      this.audioProcessing.validateSourceWav(sourceMetadata);
      this.logger.log(`ffprobe completed for track ${trackId}`);

      const sourceChecksum = await this.audioProcessing.calculateSha256(sourcePath);
      if (
        track.sourceUpload.expectedChecksumSha256 &&
        track.sourceUpload.expectedChecksumSha256 !== sourceChecksum
      ) {
        throw new BadRequestException('Uploaded WAV checksum does not match the expected checksum');
      }

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
            this.audioProcessing.encodeRendition(sourcePath, outputPath, rendition, trackId),
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

      const assets = await this.runStage(ProcessingStage.DATABASE, track, async () => {
        await this.audioAssetModel.deleteMany({
          trackId: track._id,
          version: AUDIO_VERSION,
        });
        return this.audioAssetModel.insertMany(
          encodedResults.map((encoded) =>
            this.toAudioAssetDocument(track._id, trackId, encoded),
          ),
          { ordered: true },
        );
      });

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
       * The original master stays in S3 because it was uploaded directly by the
       * client and can be reused for a retry. Derived delivery assets are safe
       * to delete when a partial processing run fails.
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

    const assets = await this.findAssets(track._id);
    return this.toTrackResponse(track, assets);
  }

  private assertDirectUploadRequest(dto: InitiateTrackUploadDto): void {
    const acceptedMimeTypes = new Set(['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/vnd.wave']);
    const extension = extname(dto.fileName).toLowerCase();
    if (extension !== '.wav' || !acceptedMimeTypes.has(dto.contentType)) {
      throw new BadRequestException('Only valid WAV audio files are supported');
    }

    const maxSizeMb = this.config.getOrThrow<number>('upload.maxSizeMb');
    const maxBytes = maxSizeMb * 1024 * 1024;
    if (dto.sizeBytes > maxBytes) {
      throw new PayloadTooLargeException(`File exceeds maximum upload size of ${maxSizeMb} MB`);
    }
  }

  private assertUploadedSourceObject(
    track: TrackDocument,
    uploadedSizeBytes?: number,
    uploadedContentType?: string,
  ): void {
    if (!uploadedSizeBytes || uploadedSizeBytes <= 0) {
      throw new BadRequestException('Source WAV has not been uploaded to S3');
    }

    const maxSizeMb = this.config.getOrThrow<number>('upload.maxSizeMb');
    const maxBytes = maxSizeMb * 1024 * 1024;
    if (uploadedSizeBytes > maxBytes) {
      throw new PayloadTooLargeException(`Uploaded source exceeds maximum size of ${maxSizeMb} MB`);
    }

    if (track.sourceUpload && uploadedSizeBytes !== track.sourceUpload.expectedSizeBytes) {
      throw new BadRequestException('Uploaded source size does not match the expected size');
    }

    const acceptedMimeTypes = new Set(['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/vnd.wave']);
    if (uploadedContentType && !acceptedMimeTypes.has(uploadedContentType)) {
      throw new BadRequestException('Uploaded source has an unsupported content type');
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

  private findAssets(trackId: Types.ObjectId): Promise<AudioAssetDocument[]> {
    return this.audioAssetModel
      .find({ trackId })
      .sort({ version: 1, bitrate: 1 })
      .exec();
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
      sourceUpload: raw.sourceUpload,
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
    if (error instanceof HttpException) {
      return error;
    }
    return new InternalServerErrorException('Track processing failed');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown processing error';
  }
}
