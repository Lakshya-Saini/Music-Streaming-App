import { IsIn, IsOptional, IsString } from 'class-validator';

export type StreamQuality = 'auto' | 'low' | 'normal' | 'high' | 'very_high';
export type NetworkProfile = 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';

export class StreamTrackQueryDto {
  @IsOptional()
  @IsIn(['auto', 'low', 'normal', 'high', 'very_high'])
  quality: StreamQuality = 'auto';

  @IsOptional()
  @IsIn(['slow-2g', '2g', '3g', '4g', 'unknown'])
  network: NetworkProfile = 'unknown';

  /**
   * The native <audio> element cannot send an Authorization header, so
   * JwtAuthGuard also accepts the access token here. Declared on the DTO
   * purely so the global whitelist-validating ValidationPipe doesn't reject it.
   */
  @IsOptional()
  @IsString()
  token?: string;
}
