import { Track } from '../types';

const targetBitrates: Record<string, number> = {
  'slow-2g': 64000,
  '2g': 64000,
  '3g': 128000,
  '4g': 320000,
  unknown: 128000,
};

export function registerStreamCacheWorker(): void {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/stream-cache-worker.js').then(async () => {
      if (navigator.serviceWorker.controller || sessionStorage.getItem('stream-cache-ready')) {
        return;
      }

      sessionStorage.setItem('stream-cache-ready', '1');
      await navigator.serviceWorker.ready;
      window.location.reload();
    });
  });
}

export async function preloadStreamPrefix(
  track: Track,
  streamUrl: string,
  networkProfile: string,
  throughTime: number,
  duration: number,
): Promise<boolean> {
  const asset = selectStreamingAsset(track, networkProfile);
  if (!asset || !asset.sizeBytes || duration <= 0 || throughTime <= 0) {
    return false;
  }

  const ratio = Math.min(Math.max(throughTime / duration, 0), 1);
  const endByte = Math.min(Math.ceil(asset.sizeBytes * ratio) - 1, asset.sizeBytes - 1);
  if (endByte <= 0) {
    return false;
  }

  const response = await fetch(streamUrl, {
    headers: {
      Range: `bytes=0-${endByte}`,
    },
  });

  if (response.status !== 206 && !response.ok) {
    return false;
  }

  await response.arrayBuffer();
  return true;
}

function selectStreamingAsset(track: Track, networkProfile: string) {
  const readyAssets = track.audioAssets.filter((asset) => asset.status === 'READY');
  if (readyAssets.length === 0) {
    return null;
  }

  const targetBitrate = targetBitrates[networkProfile] ?? targetBitrates.unknown;
  const sorted = [...readyAssets].sort((left, right) => left.bitrate - right.bitrate);
  return sorted.find((asset) => asset.bitrate >= targetBitrate) ?? sorted[sorted.length - 1];
}
