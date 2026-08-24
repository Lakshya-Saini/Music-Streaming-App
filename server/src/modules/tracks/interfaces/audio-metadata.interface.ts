export interface AudioMetadata {
  codec: string;
  container: string;
  durationMs: number;
  sampleRate: number;
  channels: number;
  channelLayout?: string;
  bitDepth?: number;
  bitrate?: number;
  sizeBytes: number;
}

export interface EncodedAudioResult {
  quality: string;
  bitrate: number;
  outputPath: string;
  metadata: AudioMetadata;
  checksumSha256: string;
}
