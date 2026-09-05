import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { ImportYoutubeTrackDto } from '../dto/import-youtube-track.dto';
import { InitiateCoverUploadDto } from '../dto/initiate-cover-upload.dto';
import { InitiateTrackUploadDto } from '../dto/initiate-track-upload.dto';
import { ListTracksQueryDto } from '../dto/list-tracks-query.dto';
import { StreamTrackQueryDto } from '../dto/stream-track-query.dto';
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

  @Post('youtube-import')
  async importFromYoutube(
    @Body() dto: ImportYoutubeTrackDto,
  ): Promise<Record<string, unknown>> {
    return this.tracksService.importFromYoutube(dto);
  }

  @Post(':id/process')
  async processUploadedTrack(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.tracksService.processUploadedTrack(id);
  }

  @Post(':id/cover-upload-session')
  async createCoverUploadSession(
    @Param('id') id: string,
    @Body() dto: InitiateCoverUploadDto,
  ): Promise<Record<string, unknown>> {
    return this.tracksService.createCoverUploadSession(id, dto);
  }

  @Get(':id/cover')
  async getCover(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const cover = await this.tracksService.getCoverStream(id);
    for (const [header, value] of Object.entries(cover.headers)) {
      response.setHeader(header, value);
    }
    cover.body.pipe(response);
  }

  @Get()
  async listTracks(@Query() query: ListTracksQueryDto): Promise<Record<string, unknown>> {
    return this.tracksService.listTracks(query);
  }

  @Get(':id/stream')
  async streamTrack(
    @Param('id') id: string,
    @Query() query: StreamTrackQueryDto,
    @Headers('range') range: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const stream = await this.tracksService.createStreamingResponse(id, query, range);
    response.status(stream.statusCode);
    for (const [header, value] of Object.entries(stream.headers)) {
      response.setHeader(header, value);
    }
    stream.body.pipe(response);
  }

  @Get(':id')
  async getTrack(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.tracksService.getTrack(id);
  }
}
