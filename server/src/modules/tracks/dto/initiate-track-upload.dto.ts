import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { UploadTrackDto } from './upload-track.dto';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const optionalNumber = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === null || value === '' ? undefined : Number(value);

export class InitiateTrackUploadDto extends UploadTrackDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  fileName!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  contentType!: string;

  @Transform(optionalNumber)
  @IsInt()
  @Min(1)
  @Max(1024 * 1024 * 1024 * 20)
  sizeBytes!: number;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MinLength(64)
  checksumSha256?: string;
}
