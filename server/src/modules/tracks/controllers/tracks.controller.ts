import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { UploadTrackDto } from '../dto/upload-track.dto';
import { ListTracksQueryDto } from '../dto/list-tracks-query.dto';
import { TracksService, UploadedDiskFile } from '../services/tracks.service';
import { TEMP_ROOT } from '../constants/audio-renditions';

const multerStorage = diskStorage({
  destination: (_req, _file, callback) => {
    /**
     * Temporary disk storage keeps large uploads out of Node heap memory.
     * Each request gets an isolated directory that is deleted after processing.
     */
    const uploadDir = join(process.cwd(), TEMP_ROOT, randomUUID());
    mkdirSync(uploadDir, { recursive: true });
    callback(null, uploadDir);
  },
  filename: (_req, file, callback) => {
    callback(null, `source${extname(file.originalname).toLowerCase()}`);
  },
});

@Controller('tracks')
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multerStorage,
      limits: {
        files: 1,
        fileSize: Number(process.env.MAX_UPLOAD_SIZE_MB ?? 500) * 1024 * 1024,
      },
      fileFilter: (_req, file, callback) => {
        const acceptedMimeTypes = new Set([
          'audio/wav',
          'audio/wave',
          'audio/x-wav',
          'audio/vnd.wave',
        ]);
        const looksLikeWav = extname(file.originalname).toLowerCase() === '.wav';
        if (!looksLikeWav || !acceptedMimeTypes.has(file.mimetype)) {
          callback(new BadRequestException('Only valid WAV audio files are supported'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async uploadTrack(
    @UploadedFile() file: UploadedDiskFile | undefined,
    @Body() dto: UploadTrackDto,
  ): Promise<Record<string, unknown>> {
    return this.tracksService.createTrack(dto, file);
  }

  @Get()
  async listTracks(@Query() query: ListTracksQueryDto): Promise<Record<string, unknown>> {
    return this.tracksService.listTracks(query);
  }

  @Get(':id')
  async getTrack(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.tracksService.getTrack(id);
  }

}
