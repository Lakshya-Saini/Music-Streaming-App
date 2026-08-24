import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const optionalNumber = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return Number(value);
};

export class UploadTrackDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  title!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  artist!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MinLength(1)
  album?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MinLength(1)
  albumArtist?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MinLength(1)
  genre?: string;

  @Transform(optionalNumber)
  @IsOptional()
  @IsInt()
  @Min(1880)
  @Max(3000)
  releaseYear?: number;

  @Transform(optionalNumber)
  @IsOptional()
  @IsInt()
  @Min(1)
  trackNumber?: number;

  @Transform(optionalNumber)
  @IsOptional()
  @IsInt()
  @Min(1)
  discNumber?: number;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MinLength(1)
  composer?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MinLength(1)
  copyright?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2,3}(-[A-Z]{2})?$/, {
    message: 'language must be an ISO-like language tag such as en or en-US',
  })
  language?: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/, {
    message: 'isrc must be a valid 12-character ISRC code',
  })
  isrc?: string;
}
