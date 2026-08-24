import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { TrackStatus } from '../constants/track-status';

const optionalNumber = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === null || value === '' ? undefined : Number(value);

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListTracksQueryDto {
  @Transform(optionalNumber)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @Transform(optionalNumber)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  artist?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  album?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  genre?: string;

  @IsOptional()
  @IsEnum(TrackStatus)
  status?: TrackStatus;
}
