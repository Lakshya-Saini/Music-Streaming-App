export type AudioQuality = 'low' | 'normal' | 'high' | 'very_high';

export interface AudioRenditionConfig {
  readonly quality: AudioQuality;
  readonly bitrate: number;
  readonly label: string;
  readonly outputFileName: string;
}

/**
 * Multiple bitrate variants let future clients choose a file that fits their
 * network conditions without making the API change. For now all four are
 * generated synchronously; the same config can later drive a worker job.
 */
export const AUDIO_RENDITIONS: readonly AudioRenditionConfig[] = [
  { quality: 'low', bitrate: 64000, label: '64', outputFileName: 'aac-64.m4a' },
  { quality: 'normal', bitrate: 128000, label: '128', outputFileName: 'aac-128.m4a' },
  { quality: 'high', bitrate: 256000, label: '256', outputFileName: 'aac-256.m4a' },
  { quality: 'very_high', bitrate: 320000, label: '320', outputFileName: 'aac-320.m4a' },
];

export const AUDIO_VERSION = 1;
export const TEMP_ROOT = 'temp';
export const OUTPUT_SAMPLE_RATE = 44100;
export const OUTPUT_CHANNELS = 2;
export const BITRATE_TOLERANCE_RATIO = 0.35;
