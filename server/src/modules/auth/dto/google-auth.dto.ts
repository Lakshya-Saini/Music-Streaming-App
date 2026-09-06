import { IsString, MinLength } from 'class-validator';

export class GoogleAuthDto {
  /** The credential JWT returned by Google Identity Services on the client. */
  @IsString()
  @MinLength(1)
  idToken!: string;
}
