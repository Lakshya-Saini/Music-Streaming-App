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
import { ImportYoutubeTrackDto } from '../dto/import-youtube-track.dto';
import { InitiateCoverUploadDto } from '../dto/initiate-cover-upload.dto';
import { InitiateTrackUploadDto } from '../dto/initiate-track-upload.dto';
import { ListTracksQueryDto } from '../dto/list-tracks-query.dto';
import { NetworkProfile, StreamTrackQueryDto, StreamQuality } from '../dto/stream-track-query.dto';
import { AUDIO_VERSION } from '../constants/audio-renditions';
import { AudioAssetStatus, ProcessingStage, TrackStatus } from '../constants/track-status';
import { AudioProcessingService } from './audio-processing.service';
import { AudioStorageService } from './audio-storage.service';
import { YoutubeImportService } from './youtube-import.service';
import { Track, TrackDocument } from '../schemas/track.schema';
import { AudioAsset, AudioAssetDocument } from '../schemas/audio-asset.schema';
import { EncodedAudioResult } from '../interfaces/audio-metadata.interface';
import { Readable } from 'node:stream';

const PRESIGNED_UPLOAD_EXPIRES_SECONDS = 15 * 60;
const SOURCE_CONTENT_TYPE = 'audio/wav';
/**
 * Every streaming response is capped to a slice of the rendition instead of
 * however much the caller's Range asked for (including the wide-open
 * `bytes=0-` the browser sends by default). Without a cap, a single request
 * for an unbounded range causes S3 - and this server - to hand back the
 * entire multi-megabyte file in one response, which defeats adaptive
 * bitrate switching mid-track and wastes bandwidth on audio the listener
 * may never reach. Capping forces the `<audio>` element to keep asking for
 * more as playback actually progresses, the same pull-based behavior a
 * segmented HLS/DASH stream gives for free.
 */
const STREAM_CHUNK_PARTS = 10;
const MIN_STREAM_CHUNK_BYTES = 256 * 1024;
const MAX_STREAM_CHUNK_BYTES = 2 * 1024 * 1024;
const ACCEPTED_COVER_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class TracksService {
  private readonly logger = new Logger(TracksService.name);

  constructor(
    @InjectModel(Track.name) private readonly trackModel: Model<TrackDocument>,
    @InjectModel(AudioAsset.name) private readonly audioAssetModel: Model<AudioAssetDocument>,
    private readonly audioProcessing: AudioProcessingService,
    private readonly audioStorage: AudioStorageService,
    private readonly youtubeImport: YoutubeImportService,
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

  async createCoverUploadSession(
    id: string,
    dto: InitiateCoverUploadDto,
  ): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid track id');
    }

    const track = await this.trackModel.findById(id).exec();
    if (!track) {
      throw new NotFoundException('Track not found');
    }

    const extension = ACCEPTED_COVER_MIME_TYPES[dto.contentType];
    if (!extension) {
      throw new BadRequestException('Only JPEG, PNG, or WEBP cover images are supported');
    }

    const objectKey = this.coverObjectKey(id, extension);

    const uploadUrl = await this.audioStorage.createPresignedUploadUrl({
      objectKey,
      contentType: dto.contentType,
      expiresInSeconds: PRESIGNED_UPLOAD_EXPIRES_SECONDS,
    });

    await this.trackModel.updateOne(
      { _id: track._id },
      {
        $set: {
          coverImage: {
            objectKey,
            contentType: dto.contentType,
            sizeBytes: dto.sizeBytes,
          },
        },
      },
    );

    this.logger.log(`Created direct S3 cover upload session for track ${id}`);

    return {
      upload: {
        method: 'PUT',
        url: uploadUrl,
        objectKey,
        headers: {
          'Content-Type': dto.contentType,
        },
      },
      coverUrl: this.coverPath(id),
    };
  }

  async getCoverStream(id: string): Promise<{
    body: Readable;
    headers: Record<string, string | number>;
  }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid track id');
    }

    const track = await this.trackModel.findById(id).exec();
    if (!track?.coverImage) {
      throw new NotFoundException('Track does not have a cover image');
    }

    const objectStream = await this.audioStorage.getObjectStream(track.coverImage.objectKey);

    return {
      body: objectStream.body,
      headers: {
        'Content-Type': objectStream.contentType ?? track.coverImage.contentType,
        'Cache-Control': 'public, max-age=86400',
        ...(objectStream.contentLength !== undefined
          ? { 'Content-Length': objectStream.contentLength }
          : {}),
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

      const { assets, readyTrack } = await this.encodeUploadAndActivate(
        track,
        trackId,
        tempDir,
        sourcePath,
        sourceObjectKey,
        uploadedOutputKeys,
        track.sourceUpload.expectedChecksumSha256,
      );

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

  async importFromYoutube(dto: ImportYoutubeTrackDto): Promise<Record<string, unknown>> {
    if (!dto.authorizationConfirmed) {
      throw new BadRequestException(
        'You must confirm you are authorized to download and use this video before importing it',
      );
    }

    const metadata = await this.runStage(
      ProcessingStage.FETCH_YOUTUBE_METADATA,
      undefined,
      () => this.youtubeImport.fetchMetadata(dto.url),
    );

    const trackObjectId = new Types.ObjectId();
    const trackId = trackObjectId.toString();
    const sourceObjectKey = this.sourceObjectKey(trackId);

    const track = await this.trackModel.create({
      _id: trackObjectId,
      title: dto.title || metadata.title || 'Untitled',
      artist: dto.artist || metadata.uploader || 'Unknown artist',
      album: dto.album,
      genre: dto.genre,
      language: dto.language,
      releaseYear: dto.releaseYear,
      status: TrackStatus.PROCESSING,
      activeAudioVersion: AUDIO_VERSION,
      importSource: {
        provider: 'youtube',
        sourceUrl: dto.url,
        sourceId: metadata.id || undefined,
        importedTitle: metadata.title,
        importedUploader: metadata.uploader,
      },
    });

    const tempDir = join(process.cwd(), 'temp', trackId);
    const sourcePath = join(tempDir, 'source.wav');
    const uploadedOutputKeys: string[] = [];

    this.logger.log(`YouTube import started for track ${trackId}: ${dto.url}`);

    try {
      await mkdir(tempDir, { recursive: true });

      const downloadedAudioPath = await this.runStage(
        ProcessingStage.DOWNLOAD_YOUTUBE_AUDIO,
        track,
        () => this.youtubeImport.downloadAudio(dto.url, tempDir),
      );
      this.logger.log(`Downloaded YouTube audio for track ${trackId}`);

      await this.runStage(ProcessingStage.TRANSCODE_SOURCE, track, () =>
        this.audioProcessing.transcodeToWav(downloadedAudioPath, sourcePath),
      );
      this.logger.log(`Transcoded YouTube audio to WAV source for track ${trackId}`);

      await this.runStage(ProcessingStage.UPLOAD_SOURCE, track, () =>
        this.audioStorage.uploadFile({
          filePath: sourcePath,
          objectKey: sourceObjectKey,
          contentType: SOURCE_CONTENT_TYPE,
        }),
      );

      const { assets, readyTrack } = await this.encodeUploadAndActivate(
        track,
        trackId,
        tempDir,
        sourcePath,
        sourceObjectKey,
        uploadedOutputKeys,
      );

      await this.importCoverFromYoutube(trackId, trackObjectId, metadata.thumbnailUrl, tempDir);

      this.logger.log(`YouTube import completed for track ${trackId}`);
      const finalTrack = await this.trackModel.findById(trackObjectId).exec();
      return this.toTrackResponse(finalTrack ?? readyTrack, assets);
    } catch (error) {
      await this.markFailed(track._id, error);
      await this.cleanupUploadedRenditions(uploadedOutputKeys, trackId);
      this.logger.error(`YouTube import failed for track ${trackId}`, this.errorMessage(error));
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

    const trackIds = data.map((track) => track._id);
    const assets = await this.audioAssetModel
      .find({
        trackId: { $in: trackIds },
        version: AUDIO_VERSION,
        status: AudioAssetStatus.READY,
      })
      .sort({ bitrate: 1 })
      .lean()
      .exec();
    const assetsByTrack = new Map<string, typeof assets>();
    for (const asset of assets) {
      const key = asset.trackId.toString();
      assetsByTrack.set(key, [...(assetsByTrack.get(key) ?? []), asset]);
    }

    return {
      data: data.map((track) => {
        const id = track._id.toString();
        return {
          ...track,
          id,
          _id: undefined,
          audioAssets: (assetsByTrack.get(id) ?? []).map((asset) => ({
            id: asset._id.toString(),
            quality: asset.quality,
            bitrate: asset.bitrate,
            codec: asset.codec,
            codecProfile: asset.codecProfile,
            container: asset.container,
            sampleRate: asset.sampleRate,
            channels: asset.channels,
            durationMs: asset.durationMs,
            sizeBytes: asset.sizeBytes,
            objectKey: asset.objectKey,
            status: asset.status,
          })),
          streamUrl: this.streamPath(id),
          coverUrl: track.coverImage ? this.coverPath(id) : undefined,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async createStreamingResponse(
    id: string,
    query: StreamTrackQueryDto,
    range?: string,
  ): Promise<{
    body: Readable;
    statusCode: number;
    headers: Record<string, string | number>;
  }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid track id');
    }

    const track = await this.trackModel.findById(id).exec();
    if (!track) {
      throw new NotFoundException('Track not found');
    }
    if (track.status !== TrackStatus.READY) {
      throw new BadRequestException('Track is not ready for streaming');
    }

    const assets = await this.audioAssetModel
      .find({
        trackId: track._id,
        version: track.activeAudioVersion,
        status: AudioAssetStatus.READY,
      })
      .sort({ bitrate: 1 })
      .exec();

    if (assets.length === 0) {
      throw new NotFoundException('No playable audio renditions were found for this track');
    }

    const selected = this.selectStreamingAsset(assets, query.quality, query.network);

    const resolvedRange = this.resolveStreamRange(range, selected.sizeBytes);
    if (!resolvedRange) {
      return {
        body: Readable.from([]),
        statusCode: 416,
        headers: { 'Content-Range': `bytes */${selected.sizeBytes}` },
      };
    }

    const objectStream = await this.audioStorage.getObjectStream(
      selected.objectKey,
      `bytes=${resolvedRange.start}-${resolvedRange.end}`,
    );

    this.logger.log(
      `Streaming ${selected.bitrate} bps ${selected.quality} rendition for track ${id} (bytes ${resolvedRange.start}-${resolvedRange.end}/${selected.sizeBytes})`,
    );

    const headers: Record<string, string | number> = {
      'Content-Type': objectStream.contentType ?? 'audio/mp4',
      'Accept-Ranges': objectStream.acceptRanges ?? 'bytes',
      /**
       * An explicit quality maps deterministically to one immutable rendition
       * file, so the browser can safely cache it and replay already-streamed
       * audio without hitting the network again. `auto` picks a rendition
       * based on the caller's guessed network profile, so the same URL could
       * legitimately resolve to a different file between calls - that path
       * must stay uncached.
       */
      'Cache-Control':
        query.quality === 'auto' ? 'no-store' : 'private, max-age=604800, immutable',
      'X-Selected-Quality': selected.quality,
      'X-Selected-Bitrate': selected.bitrate,
    };

    if (objectStream.contentLength !== undefined) {
      headers['Content-Length'] = objectStream.contentLength;
    }
    if (objectStream.contentRange) {
      headers['Content-Range'] = objectStream.contentRange;
    }

    return {
      body: objectStream.body,
      statusCode: objectStream.contentRange ? 206 : 200,
      headers,
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
    track: TrackDocument | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (track) {
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
      }
      throw error;
    }
  }

  /**
   * Shared tail of both ingestion flows (direct WAV upload and YouTube
   * import): once a valid local WAV file exists, probing, encoding the four
   * AAC renditions, uploading them, and flipping the track to READY is
   * identical regardless of where the source file came from.
   */
  private async encodeUploadAndActivate(
    track: TrackDocument,
    trackId: string,
    tempDir: string,
    sourcePath: string,
    sourceObjectKey: string,
    uploadedOutputKeys: string[],
    expectedChecksumSha256?: string,
  ): Promise<{ assets: AudioAssetDocument[]; readyTrack: TrackDocument }> {
    const sourceMetadata = await this.runStage(ProcessingStage.PROBE_SOURCE, track, () =>
      this.audioProcessing.probeAudio(sourcePath),
    );
    this.audioProcessing.validateSourceWav(sourceMetadata);
    this.logger.log(`ffprobe completed for track ${trackId}`);

    const sourceChecksum = await this.audioProcessing.calculateSha256(sourcePath);
    if (expectedChecksumSha256 && expectedChecksumSha256 !== sourceChecksum) {
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
        encodedResults.map((encoded) => this.toAudioAssetDocument(track._id, trackId, encoded)),
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

    return { assets, readyTrack };
  }

  /**
   * Downloads the video's thumbnail and stores it under the same per-track
   * cover folder used by direct uploads. Failure here never fails the
   * import: the client already falls back to one of the app's bundled cover
   * images whenever a track has no coverImage set.
   */
  private async importCoverFromYoutube(
    trackId: string,
    trackObjectId: Types.ObjectId,
    thumbnailUrl: string | undefined,
    tempDir: string,
  ): Promise<void> {
    const thumbnail = await this.youtubeImport.downloadThumbnail(thumbnailUrl, join(tempDir, 'thumbnail'));
    if (!thumbnail) {
      return;
    }

    try {
      const objectKey = this.coverObjectKey(trackId, thumbnail.extension);
      await this.audioStorage.uploadFile({
        filePath: thumbnail.path,
        objectKey,
        contentType: thumbnail.contentType,
        cacheControl: 'public, max-age=86400',
      });
      await this.trackModel.updateOne(
        { _id: trackObjectId },
        {
          $set: {
            coverImage: {
              objectKey,
              contentType: thumbnail.contentType,
              sizeBytes: thumbnail.sizeBytes,
            },
          },
        },
      );
    } catch (error) {
      this.logger.warn(
        `Cover import failed for track ${trackId}, falling back to a default cover: ${this.errorMessage(error)}`,
      );
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

  private coverObjectKey(trackId: string, extension: string): string {
    return `music/tracks/${trackId}/cover/cover.${extension}`;
  }

  private streamPath(trackId: string): string {
    return `/api/v1/tracks/${trackId}/stream?quality=auto`;
  }

  private coverPath(trackId: string): string {
    return `/api/v1/tracks/${trackId}/cover`;
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

  /**
   * Clamps whatever the client asked for down to a fixed-size slice of the
   * rendition, splitting the file into roughly `STREAM_CHUNK_PARTS` pieces
   * (bounded to a sane min/max) regardless of whether the caller sent an
   * open-ended range (`bytes=0-`) or no Range header at all. Returns null
   * when the requested start is past the end of the file (416).
   */
  private resolveStreamRange(
    requestedRange: string | undefined,
    totalBytes: number,
  ): { start: number; end: number } | null {
    const chunkBytes = Math.min(
      MAX_STREAM_CHUNK_BYTES,
      Math.max(MIN_STREAM_CHUNK_BYTES, Math.ceil(totalBytes / STREAM_CHUNK_PARTS)),
    );

    const match = requestedRange?.match(/^bytes=(\d+)-(\d*)$/);
    const start = match ? Number(match[1]) : 0;
    if (start >= totalBytes) {
      return null;
    }

    const requestedEnd = match?.[2] ? Number(match[2]) : undefined;
    const end = Math.min(requestedEnd ?? totalBytes - 1, start + chunkBytes - 1, totalBytes - 1);

    return { start, end };
  }

  private selectStreamingAsset(
    assets: readonly AudioAssetDocument[],
    quality: StreamQuality,
    network: NetworkProfile,
  ): AudioAssetDocument {
    if (quality !== 'auto') {
      const exact = assets.find((asset) => asset.quality === quality);
      if (exact) {
        return exact;
      }
    }

    const targetBitrate = this.targetBitrateForNetwork(network);
    const sorted = [...assets].sort((left, right) => left.bitrate - right.bitrate);
    return (
      sorted.find((asset) => asset.bitrate >= targetBitrate) ??
      sorted[sorted.length - 1]
    );
  }

  private targetBitrateForNetwork(network: NetworkProfile): number {
    switch (network) {
      case 'slow-2g':
      case '2g':
        return 64000;
      case '3g':
        return 128000;
      case '4g':
        return 320000;
      case 'unknown':
      default:
        return 128000;
    }
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
      coverUrl: raw.coverImage ? this.coverPath(raw._id.toString()) : undefined,
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
