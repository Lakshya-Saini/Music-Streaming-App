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
}

export type UploadStageStatus = 'waiting' | 'active' | 'complete' | 'failed';

export interface UploadStage {
  id: string;
  label: string;
  detail: string;
  status: UploadStageStatus;
}
