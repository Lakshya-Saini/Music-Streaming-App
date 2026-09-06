import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { TracksController } from './controllers/tracks.controller';
import { TracksService } from './services/tracks.service';
import { AudioProcessingService } from './services/audio-processing.service';
import { AudioStorageService } from './services/audio-storage.service';
import { YoutubeImportService } from './services/youtube-import.service';
import { Track, TrackSchema } from './schemas/track.schema';
import { AudioAsset, AudioAssetSchema } from './schemas/audio-asset.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Track.name, schema: TrackSchema },
      { name: AudioAsset.name, schema: AudioAssetSchema },
    ]),
  ],
  controllers: [TracksController],
  providers: [TracksService, AudioProcessingService, AudioStorageService, YoutubeImportService],
})
export class TracksModule {}
