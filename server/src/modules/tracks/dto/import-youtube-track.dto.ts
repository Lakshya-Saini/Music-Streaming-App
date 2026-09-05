import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const optionalNumber = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === null || value === '' ? undefined : Number(value);

export class ImportYoutubeTrackDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  url!: string;

  /**
   * Required and must be true: yt-dlp can reach far more than YouTube, so this
   * flag (paired with the host allow-list enforced in YoutubeImportService) is
   * the app's explicit gate on only importing content the operator attests
   * they are authorized to download.
   */
  @IsBoolean()
  authorizationConfirmed!: boolean;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  title?: string;

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

  @Transform(trimString)
  @IsOptional()
  @IsString()
  language?: string;

  @Transform(optionalNumber)
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  releaseYear?: number;
}
