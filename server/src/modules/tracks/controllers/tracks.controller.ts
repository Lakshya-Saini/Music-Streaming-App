import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InitiateTrackUploadDto } from '../dto/initiate-track-upload.dto';
import { ListTracksQueryDto } from '../dto/list-tracks-query.dto';
import { TracksService } from '../services/tracks.service';

@Controller('tracks')
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  @Post('upload-session')
  async createUploadSession(
    @Body() dto: InitiateTrackUploadDto,
  ): Promise<Record<string, unknown>> {
    return this.tracksService.createUploadSession(dto);
  }

  @Post(':id/process')
  async processUploadedTrack(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.tracksService.processUploadedTrack(id);
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
