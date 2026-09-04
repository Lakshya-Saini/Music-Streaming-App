import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
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

  @Post(':id/process')
  async processUploadedTrack(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.tracksService.processUploadedTrack(id);
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
