export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: number;
  duration: number;
  bitrate: number;
  cover: string;
  color: string;
  streamUrl: string;
  audioAssets: AudioAsset[];
}

export interface AudioAsset {
  id: string;
  quality: 'low' | 'normal' | 'high' | 'very_high';
  bitrate: number;
  sizeBytes: number;
  codec: string;
  container: string;
  objectKey: string;
  status: string;
}

export type UploadStageStatus = 'waiting' | 'active' | 'complete' | 'failed';

export interface UploadStage {
  id: string;
  label: string;
  detail: string;
  status: UploadStageStatus;
}
