import { streamingUrlForQuality } from '../api/tracks';
import { AudioAsset, Track } from '../types';

/**
 * `navigator.connection.effectiveType` doesn't reflect Chrome DevTools network
 * throttling and isn't supported in Safari/Firefox at all, so it can't drive
 * real adaptive bitrate decisions. Instead we measure actual throughput with a
 * small ranged fetch against the lowest-bitrate rendition (always cheap and
 * available) before starting playback, the same way a real player probes the
 * network it is actually on.
 */
const PROBE_BYTES = 128 * 1024;
/**
 * Fetched and discarded before the timed sample below. Without it, the timed
 * request pays for DNS/TLS/TCP setup and slow-start ramp-up as part of the
 * measurement, which dominates the elapsed time for a small probe and makes
 * even a fast connection look slow - the reported cause of high-bandwidth
 * networks (e.g. Fast 4G) still resolving to a low-quality rendition.
 */
const PROBE_WARMUP_BYTES = 16 * 1024;
const PROBE_TIMEOUT_MS = 4000;
/** Require this much throughput headroom over a rendition's bitrate before picking it, so playback can stay ahead of realtime without constant rebuffering. */
const ABR_SAFETY_FACTOR = 1.4;

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

export function sortedReadyAssets(track: Track): AudioAsset[] {
  return [...track.audioAssets].filter((asset) => asset.status === 'READY').sort((left, right) => left.bitrate - right.bitrate);
}

/** Measures real download throughput; returns null if the probe couldn't complete (offline, timeout, error). */
export async function probeThroughputBytesPerSecond(track: Track): Promise<number | null> {
  const assets = sortedReadyAssets(track);
  const lowest = assets[0];
  if (!lowest) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const url = streamingUrlForQuality(track.id, lowest.quality);

  try {
    await fetch(url, {
      headers: { Range: `bytes=0-${PROBE_WARMUP_BYTES - 1}` },
      signal: controller.signal,
    });

    const startedAt = performance.now();
    const response = await fetch(url, {
      headers: {
        Range: `bytes=${PROBE_WARMUP_BYTES}-${PROBE_WARMUP_BYTES + PROBE_BYTES - 1}`,
      },
      signal: controller.signal,
    });
    if (!response.ok && response.status !== 206) {
      return null;
    }
    const buffer = await response.arrayBuffer();
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    if (elapsedSeconds <= 0 || buffer.byteLength === 0) {
      return null;
    }
    return buffer.byteLength / elapsedSeconds;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Picks the highest-bitrate rendition the measured connection can sustain, with a safety margin. */
export function pickQualityForThroughput(track: Track, bytesPerSecond: number | null): AudioAsset | null {
  const assets = sortedReadyAssets(track);
  if (assets.length === 0) {
    return null;
  }

  if (bytesPerSecond === null) {
    // Probe failed rather than measured "slow" - fall back to a conservative middle tier.
    return assets[Math.min(1, assets.length - 1)];
  }

  const affordable = assets.filter((asset) => (asset.bitrate / 8) * ABR_SAFETY_FACTOR <= bytesPerSecond);
  return affordable.length > 0 ? affordable[affordable.length - 1] : assets[0];
}

/** One tier down from the given asset, or null if it's already the lowest available. */
export function nextLowerQuality(track: Track, currentAssetId: string): AudioAsset | null {
  const assets = sortedReadyAssets(track);
  const index = assets.findIndex((asset) => asset.id === currentAssetId);
  if (index <= 0) {
    return null;
  }
  return assets[index - 1];
}

/** One tier up from the given asset, or null if it's already the highest available. */
export function nextHigherQuality(track: Track, currentAssetId: string): AudioAsset | null {
  const assets = sortedReadyAssets(track);
  const index = assets.findIndex((asset) => asset.id === currentAssetId);
  if (index === -1 || index >= assets.length - 1) {
    return null;
  }
  return assets[index + 1];
}
