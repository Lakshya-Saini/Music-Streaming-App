import { IsIn, IsOptional } from 'class-validator';

export type StreamQuality = 'auto' | 'low' | 'normal' | 'high' | 'very_high';
export type NetworkProfile = 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';

export class StreamTrackQueryDto {
  @IsOptional()
  @IsIn(['auto', 'low', 'normal', 'high', 'very_high'])
  quality: StreamQuality = 'auto';

  @IsOptional()
  @IsIn(['slow-2g', '2g', '3g', '4g', 'unknown'])
  network: NetworkProfile = 'unknown';
}
