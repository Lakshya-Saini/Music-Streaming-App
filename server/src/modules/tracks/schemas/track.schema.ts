import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { TrackStatus } from '../constants/track-status';

export type TrackDocument = HydratedDocument<Track>;

@Schema({ _id: false })
export class SourceAudio {
  @Prop({ required: true })
  codec!: string;

  @Prop({ required: true })
  container!: string;

  @Prop({ required: true })
  sampleRate!: number;

  @Prop({ required: true })
  channels!: number;

  @Prop()
  channelLayout?: string;

  @Prop()
  bitDepth?: number;

  @Prop()
  bitrate?: number;

  @Prop({ required: true })
  sizeBytes!: number;

  @Prop({ required: true })
  checksumSha256!: string;

  @Prop({ required: true })
  objectKey!: string;
}

@Schema({ _id: false })
export class ProcessingError {
  @Prop()
  message?: string;

  @Prop()
  stage?: string;
}

@Schema({ _id: false })
export class CoverImage {
  @Prop({ required: true })
  objectKey!: string;

  @Prop({ required: true })
  contentType!: string;

  @Prop({ required: true })
  sizeBytes!: number;
}

@Schema({ _id: false })
export class SourceUpload {
  @Prop({ required: true })
  objectKey!: string;

  @Prop({ required: true })
  originalFileName!: string;

  @Prop({ required: true })
  contentType!: string;

  @Prop({ required: true })
  expectedSizeBytes!: number;

  @Prop()
  expectedChecksumSha256?: string;

  @Prop()
  uploadUrlExpiresAt?: Date;
}

@Schema({ timestamps: true, collection: 'tracks' })
export class Track {
  @Prop({ required: true, trim: true, index: true })
  title!: string;

  @Prop({ required: true, trim: true, index: true })
  artist!: string;

  @Prop({ trim: true, index: true })
  album?: string;

  @Prop({ trim: true })
  albumArtist?: string;

  @Prop({ trim: true, index: true })
  genre?: string;

  @Prop()
  releaseYear?: number;

  @Prop()
  trackNumber?: number;

  @Prop()
  discNumber?: number;

  @Prop({ trim: true })
  composer?: string;

  @Prop({ trim: true })
  copyright?: string;

  @Prop({ trim: true })
  language?: string;

  @Prop({ trim: true })
  isrc?: string;

  @Prop({ default: 0 })
  durationMs!: number;

  @Prop({ enum: TrackStatus, required: true, default: TrackStatus.UPLOADING, index: true })
  status!: TrackStatus;

  @Prop({ default: 1 })
  activeAudioVersion!: number;

  /**
   * Raw audio bytes stay in S3, not MongoDB. MongoDB keeps searchable metadata
   * and S3 object keys so documents remain small and cheap to query.
   */
  @Prop({ type: SourceAudio })
  source?: SourceAudio;

  @Prop({ type: SourceUpload })
  sourceUpload?: SourceUpload;

  @Prop({ type: CoverImage })
  coverImage?: CoverImage;

  @Prop({ type: ProcessingError })
  processingError?: ProcessingError;

  createdAt?: Date;
  updatedAt?: Date;
}

export const TrackSchema = SchemaFactory.createForClass(Track);

/**
 * `language_override` is required here: MongoDB's text index otherwise reads
 * each document's own `language` field to pick a stemming language, and our
 * `language` field holds track metadata (e.g. "hi", "pa") rather than one of
 * Mongo's supported text-search language names, which would reject inserts.
 */
TrackSchema.index(
  { title: 'text', artist: 'text', album: 'text', genre: 'text' },
  { language_override: 'textIndexLanguage' },
);
