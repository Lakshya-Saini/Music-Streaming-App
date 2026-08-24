import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AudioQuality } from '../constants/audio-renditions';
import { AudioAssetStatus } from '../constants/track-status';

export type AudioAssetDocument = HydratedDocument<AudioAsset>;

@Schema({ timestamps: true, collection: 'audioassets' })
export class AudioAsset {
  @Prop({ type: Types.ObjectId, ref: 'Track', required: true, index: true })
  trackId!: Types.ObjectId;

  @Prop({ required: true })
  version!: number;

  @Prop({ required: true, enum: ['low', 'normal', 'high', 'very_high'] })
  quality!: AudioQuality;

  @Prop({ required: true, default: 'aac' })
  codec!: 'aac';

  @Prop({ required: true, default: 'LC' })
  codecProfile!: 'LC';

  @Prop({ required: true, default: 'm4a' })
  container!: 'm4a';

  @Prop({ required: true, index: true })
  bitrate!: number;

  @Prop({ required: true })
  sampleRate!: number;

  @Prop({ required: true })
  channels!: number;

  @Prop()
  channelLayout?: string;

  @Prop({ required: true })
  durationMs!: number;

  @Prop({ required: true })
  sizeBytes!: number;

  @Prop({ required: true })
  checksumSha256!: string;

  @Prop({ required: true })
  objectKey!: string;

  @Prop({ required: true, enum: AudioAssetStatus, default: AudioAssetStatus.PROCESSING })
  status!: AudioAssetStatus;

  createdAt?: Date;
  updatedAt?: Date;
}

export const AudioAssetSchema = SchemaFactory.createForClass(AudioAsset);

AudioAssetSchema.index({ trackId: 1, version: 1 });
AudioAssetSchema.index({ trackId: 1, version: 1, bitrate: 1 }, { unique: true });
