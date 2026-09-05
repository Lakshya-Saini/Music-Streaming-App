import { Transform } from 'class-transformer';
import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const optionalNumber = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === null || value === '' ? undefined : Number(value);

export class InitiateCoverUploadDto {
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
  @Max(10 * 1024 * 1024)
  sizeBytes!: number;
}
