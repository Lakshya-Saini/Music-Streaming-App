import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  HeadObjectCommand,
  HeadObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export interface UploadFileOptions {
  filePath: string;
  objectKey: string;
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface PresignedUploadOptions {
  objectKey: string;
  contentType: string;
  expiresInSeconds: number;
  metadata?: Record<string, string>;
}

export interface PresignedDownloadOptions {
  objectKey: string;
  expiresInSeconds: number;
}

export interface ObjectInfo {
  objectKey: string;
  sizeBytes?: number;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface ObjectStream {
  body: Readable;
  contentLength?: number;
  contentRange?: string;
  contentType?: string;
  acceptRanges?: string;
}

@Injectable()
export class AudioStorageService {
  private readonly logger = new Logger(AudioStorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.getOrThrow<string>('aws.s3Bucket');

    const accessKeyId = this.config.get<string>('aws.accessKeyId');
    const secretAccessKey = this.config.get<string>('aws.secretAccessKey');

    this.s3 = new S3Client({
      region: this.config.getOrThrow<string>('aws.region'),
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });
  }

  async uploadFile(options: UploadFileOptions): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: options.objectKey,
        Body: createReadStream(options.filePath),
        ContentType: options.contentType,
        CacheControl: options.cacheControl,
        Metadata: options.metadata,
      }),
    );
  }

  async createPresignedUploadUrl(options: PresignedUploadOptions): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: options.objectKey,
      ContentType: options.contentType,
      Metadata: options.metadata,
    });

    return getSignedUrl(this.s3, command, {
      expiresIn: options.expiresInSeconds,
    });
  }

  async createPresignedDownloadUrl(options: PresignedDownloadOptions): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: options.objectKey,
    });

    return getSignedUrl(this.s3, command, {
      expiresIn: options.expiresInSeconds,
    });
  }

  async downloadFile(objectKey: string, destinationPath: string): Promise<void> {
    const response = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
    );

    if (!response.Body) {
      throw new Error(`S3 object has no body: ${objectKey}`);
    }

    await pipeline(response.Body as Readable, createWriteStream(destinationPath));
  }

  async getObjectStream(objectKey: string, range?: string): Promise<ObjectStream> {
    const response: GetObjectCommandOutput = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Range: range,
      }),
    );

    if (!response.Body) {
      throw new Error(`S3 object has no body: ${objectKey}`);
    }

    return {
      body: response.Body as Readable,
      contentLength: response.ContentLength,
      contentRange: response.ContentRange,
      contentType: response.ContentType,
      acceptRanges: response.AcceptRanges,
    };
  }

  async deleteFile(objectKey: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
    );
  }

  async objectExists(objectKey: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
      );
      return true;
    } catch (error) {
      this.logger.debug(`S3 object missing or inaccessible: ${objectKey}`);
      return false;
    }
  }

  async getObjectInfo(objectKey: string): Promise<ObjectInfo> {
    const response: HeadObjectCommandOutput = await this.s3.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
    );

    return {
      objectKey,
      sizeBytes: response.ContentLength,
      contentType: response.ContentType,
      metadata: response.Metadata,
    };
  }
}
