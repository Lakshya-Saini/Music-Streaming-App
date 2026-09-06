import { Box, IconButton, Menu, MenuItem, Slider, Tooltip } from '@mui/material';
import {
  AlertTriangle,
  ChevronDown,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioAsset, Track } from '../types';
import { formatDuration } from '../utils/format';
import { streamingUrlForQuality } from '../api/tracks';
import {
  nextHigherQuality,
  nextLowerQuality,
  pickQualityForThroughput,
  probeThroughputBytesPerSecond,
} from '../utils/streamCache';

interface MusicPlayerProps {
  tracks: Track[];
  activeTrack: Track;
  onTrackChange: (track: Track) => void;
  queueOpen: boolean;
  onToggleQueue: () => void;
}

type RepeatMode = 'off' | 'one' | 'all';

interface PlayerNotice {
  kind: 'buffering' | 'error';
  text: string;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
/** How often, while playing, to re-check whether the connection can now sustain a higher rendition. */
const UPGRADE_CHECK_INTERVAL_MS = 25000;

export function MusicPlayer({
  tracks,
  activeTrack,
  onTrackChange,
  queueOpen,
  onToggleQueue,
}: MusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadRequestRef = useRef(0);
  const stallTimestampsRef = useRef<number[]>([]);
  const [speedAnchor, setSpeedAnchor] = useState<HTMLElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loadedTime, setLoadedTime] = useState(0);
  const [duration, setDuration] = useState(activeTrack.duration);
  const [volume, setVolume] = useState(0.78);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('all');
  const [speed, setSpeed] = useState(1);
  const [notice, setNotice] = useState<PlayerNotice | null>(null);
  const [currentAsset, setCurrentAsset] = useState<AudioAsset | null>(null);

  const activeIndex = useMemo(
    () => tracks.findIndex((track) => track.id === activeTrack.id),
    [activeTrack.id, tracks],
  );
  const loadedPercent = duration > 0 ? Math.min(100, (loadedTime / duration) * 100) : 0;
  const isBuffering = notice?.kind === 'buffering';

  const showBuffering = (text: string) => setNotice({ kind: 'buffering', text });
  const showError = (text: string) => setNotice({ kind: 'error', text });
  const clearNotice = () => setNotice(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
    audio.playbackRate = speed;
  }, [muted, speed, volume]);

  /**
   * The stream is only ever loaded lazily (see ensureStreamReady), so switching
   * tracks just tears down whatever was playing. If music was already playing
   * when the track changed (Next/Prev/auto-advance), it resumes automatically;
   * otherwise the next stream doesn't start until Play is pressed again.
   */
  useEffect(() => {
    const audio = audioRef.current;
    const shouldContinuePlaying = playing;

    setCurrentTime(0);
    setLoadedTime(0);
    setDuration(activeTrack.duration);
    clearNotice();
    setCurrentAsset(null);
    stallTimestampsRef.current = [];

    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();

    if (shouldContinuePlaying) {
      void (async () => {
        const asset = await ensureStreamReady();
        if (!asset || audioRef.current !== audio) return;
        try {
          await audio.play();
          setPlaying(true);
        } catch {
          setPlaying(false);
          showError('Playback could not start for this track.');
        }
      })();
    } else {
      setPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack]);

  /** Every so often, check whether the connection now supports a better rendition than the one picked at play time. */
  useEffect(() => {
    if (!playing || !currentAsset) return;
    const interval = setInterval(() => {
      void maybeUpgradeQuality();
    }, UPGRADE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, currentAsset, activeTrack]);

  useEffect(() => {
    const handleOnline = () => clearNotice();
    const handleOffline = () => showError('You are offline. Already streamed audio remains playable.');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return;
      }
      if (target?.getAttribute('role') === 'slider' || target?.closest('.MuiSlider-root')) {
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        seekBy(10);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seekBy(-10);
      }
      if (event.key === ' ') {
        event.preventDefault();
        void togglePlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const selectRelativeTrack = (direction: 1 | -1) => {
    if (tracks.length === 0) return;
    if (shuffle && direction === 1) {
      const next = tracks[Math.floor(Math.random() * tracks.length)];
      onTrackChange(next);
      return;
    }
    const nextIndex = (activeIndex + direction + tracks.length) % tracks.length;
    onTrackChange(tracks[nextIndex]);
  };

  /**
   * The stream is never attached until this runs, so nothing downloads just
   * from selecting a track. It picks a rendition by measuring real throughput
   * against the smallest file (immune to navigator.connection's blind spots,
   * like DevTools throttling) instead of trusting a reported connection type.
   * If a stream is already loaded for this track, it's reused as-is - no
   * re-probing or re-fetching of audio already sitting in the browser.
   */
  const ensureStreamReady = async (): Promise<AudioAsset | null> => {
    const audio = audioRef.current;
    if (!audio) return null;
    if (audio.src && currentAsset) {
      return currentAsset;
    }

    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;

    showBuffering('Preparing stream...');
    const measured = await probeThroughputBytesPerSecond(activeTrack);
    if (loadRequestRef.current !== requestId || audioRef.current !== audio) {
      return null;
    }

    const asset = pickQualityForThroughput(activeTrack, measured);
    if (!asset) {
      showError('No playable audio found for this track.');
      return null;
    }

    setCurrentAsset(asset);
    audio.src = streamingUrlForQuality(activeTrack.id, asset.quality);
    audio.load();
    clearNotice();
    return asset;
  };

  /** Swaps to a different rendition in place, preserving position and resuming playback if it was already playing. */
  const switchToAsset = (nextAsset: AudioAsset, noticeText: string) => {
    const audio = audioRef.current;
    if (!audio) return;

    const resumeAt = audio.currentTime;
    const wasPlaying = playing;
    showBuffering(noticeText);
    setCurrentAsset(nextAsset);
    audio.src = streamingUrlForQuality(activeTrack.id, nextAsset.quality);

    const onReady = () => {
      audio.removeEventListener('loadedmetadata', onReady);
      audio.currentTime = resumeAt;
      if (wasPlaying) {
        void audio.play().catch(() => showError('Playback could not resume after switching quality.'));
      }
      clearNotice();
    };
    audio.addEventListener('loadedmetadata', onReady);
    audio.load();
  };

  /** Drops to the next lower rendition in place, keeping playback position. */
  const downgradeQuality = () => {
    if (!currentAsset) return;
    const lower = nextLowerQuality(activeTrack, currentAsset.id);
    if (!lower) return;
    switchToAsset(lower, 'Switching to a lower quality stream...');
  };

  /** Opportunistic upgrade once conditions look better than what the current rendition needs. */
  const maybeUpgradeQuality = async () => {
    if (!currentAsset) return;
    const higher = nextHigherQuality(activeTrack, currentAsset.id);
    if (!higher) return;

    const measured = await probeThroughputBytesPerSecond(activeTrack);
    const best = pickQualityForThroughput(activeTrack, measured);
    if (!best || best.bitrate <= currentAsset.bitrate) return;
    switchToAsset(best, 'A faster connection was detected - switching to a higher quality stream...');
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    if (!navigator.onLine && audio.currentTime > locallyLoadedThrough(audio, loadedTime)) {
      showError('You are offline. This position has not been streamed yet.');
      return;
    }

    const asset = await ensureStreamReady();
    if (!asset) return;

    try {
      await audio.play();
      setPlaying(true);
      clearNotice();
    } catch {
      setPlaying(false);
      showError('Playback could not start. Check the network request for the stream endpoint.');
    }
  };

  const seek = (_event: Event, value: number | number[]) => {
    const requestedTime = Array.isArray(value) ? value[0] : value;
    void seekTo(requestedTime);
  };

  /**
   * Seeking hands off to the browser's own HTTP-range-based seeking rather
   * than manually pre-fetching everything from byte 0 up to the target: the
   * AAC files are faststart-encoded, so the media engine can jump straight to
   * the target region and only fetch what's actually missing there, the same
   * way a real player does it. onWaiting/onSeeking already show a buffering
   * spinner for whatever brief fetch that requires. If the target is already
   * buffered (e.g. seeking backward), the seek is effectively instant.
   */
  const seekTo = async (requestedTime: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const asset = await ensureStreamReady();
    if (!asset) {
      return;
    }

    const trackDuration = duration || activeTrack.duration;
    const loadedThrough = locallyLoadedThrough(audio, loadedTime);
    const nextTime = playableSeekTime(audio, requestedTime, trackDuration, loadedThrough);

    if (!navigator.onLine && nextTime < requestedTime) {
      showError('That part has not been streamed yet. Reconnect to jump further.');
    }

    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const handleTimeUpdate = (audio: HTMLAudioElement) => {
    if (!navigator.onLine && audio.currentTime + 0.5 > locallyLoadedThrough(audio, loadedTime)) {
      audio.pause();
      setPlaying(false);
      showError('You reached the end of the streamed audio. Reconnect to continue.');
      return;
    }
    setCurrentTime(audio.currentTime);
  };

  const seekBy = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const requestedTime = Math.min(
      Math.max(audio.currentTime + seconds, 0),
      duration || activeTrack.duration,
    );
    void seekTo(requestedTime);
  };

  const updateBufferedTime = () => {
    const audio = audioRef.current;
    if (!audio || audio.buffered.length === 0) {
      return;
    }

    setLoadedTime((current) => Math.max(current, contiguousBufferedEnd(audio)));
  };

  const handlePlayerError = () => {
    setPlaying(false);
    showError('Streaming failed. The track may still be processing, the connection may be offline, or the S3 object may be unavailable.');
  };

  /** Two stalls within 20s means the current rendition is too heavy for this connection - drop a tier. */
  const handleWaiting = () => {
    showBuffering('Buffering audio...');
    const now = Date.now();
    const recentStalls = [...stallTimestampsRef.current, now].filter((timestamp) => now - timestamp < 20000);
    stallTimestampsRef.current = recentStalls;
    if (recentStalls.length >= 2) {
      stallTimestampsRef.current = [];
      downgradeQuality();
    }
  };

  const handleEnded = () => {
    if (repeat === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play();
      return;
    }
    if (repeat === 'all') {
      selectRelativeTrack(1);
      return;
    }
    setPlaying(false);
  };

  const toggleRepeat = () => {
    setRepeat((current) => (current === 'off' ? 'all' : current === 'all' ? 'one' : 'off'));
  };

  const selectSpeed = (option: number) => {
    setSpeed(option);
    setSpeedAnchor(null);
  };

  const clampedTime = Math.min(currentTime, duration || activeTrack.duration);
  const speedOpen = Boolean(speedAnchor);

  return (
    <Box className="player-dock">
      <audio
        ref={audioRef}
        preload="none"
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || activeTrack.duration);
          // audio.load() resets playbackRate to 1 in every browser; reapply
          // the selected speed each time a new resource finishes loading
          // (initial stream, quality switch, or track/replay reload).
          event.currentTarget.playbackRate = speed;
        }}
        onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget)}
        onProgress={updateBufferedTime}
        onCanPlay={updateBufferedTime}
        onWaiting={handleWaiting}
        onSeeking={() => showBuffering('Seeking...')}
        onSeeked={() => clearNotice()}
        onPlaying={() => {
          setPlaying(true);
          clearNotice();
        }}
        onPause={() => setPlaying(false)}
        onError={handlePlayerError}
        onEnded={handleEnded}
      />

      <Box className="mini-seek">
        <Box className="buffer-track">
          <span style={{ width: `${loadedPercent}%` }} />
        </Box>
        <Slider
          value={clampedTime}
          min={0}
          max={duration || activeTrack.duration}
          onChange={seek}
          aria-label="Playback progress"
          className="mini-seek-slider"
        />
      </Box>

      <Box className="mini-player">
        <Box className="mini-now-playing">
          <img src={activeTrack.cover} alt="" className="mini-cover" />
          <span className="mini-copy">
            <span className="mini-title-row">
              <span className="mini-title">{activeTrack.title}</span>
              {notice && (
                <Tooltip title={notice.text}>
                  {notice.kind === 'buffering' ? (
                    <Loader2 size={14} className="mini-alert mini-alert-buffering spin" />
                  ) : (
                    <AlertTriangle size={14} className="mini-alert mini-alert-error" />
                  )}
                </Tooltip>
              )}
            </span>
            <span className="mini-artist">{activeTrack.artist}</span>
          </span>
        </Box>

        <Box className="mini-transport">
          <Tooltip title="Shuffle">
            <IconButton
              onClick={() => setShuffle((value) => !value)}
              className={`mini-icon-btn mini-icon-extra${shuffle ? ' control-on' : ''}`}
            >
              <Shuffle size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Previous">
            <IconButton onClick={() => selectRelativeTrack(-1)} className="mini-icon-btn">
              <SkipBack size={18} />
            </IconButton>
          </Tooltip>
          <IconButton
            className="play-button mini"
            onClick={togglePlay}
            aria-label={isBuffering ? 'Buffering' : playing ? 'Pause' : 'Play'}
          >
            {isBuffering ? (
              <Loader2 size={20} className="spin" />
            ) : playing ? (
              <Pause size={20} />
            ) : (
              <Play size={20} />
            )}
          </IconButton>
          <Tooltip title="Next">
            <IconButton onClick={() => selectRelativeTrack(1)} className="mini-icon-btn">
              <SkipForward size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip title={`Repeat ${repeat}`}>
            <IconButton
              onClick={toggleRepeat}
              className={`mini-icon-btn mini-icon-extra${repeat !== 'off' ? ' control-on' : ''}`}
            >
              <Repeat size={16} />
            </IconButton>
          </Tooltip>
        </Box>

        <Box className="mini-progress">
          <span className="mini-progress-time">{formatDuration(clampedTime)}</span>
          <Box className="mini-progress-track">
            <Box className="buffer-track">
              <span style={{ width: `${loadedPercent}%` }} />
            </Box>
            <Slider
              value={clampedTime}
              min={0}
              max={duration || activeTrack.duration}
              onChange={seek}
              aria-label="Playback progress"
              className="mini-progress-slider"
            />
          </Box>
          <span className="mini-progress-time">{formatDuration(duration || activeTrack.duration)}</span>
        </Box>

        <Box className="mini-right">
          <Tooltip title="Playback speed">
            <button
              type="button"
              className={`mini-speed-btn mini-icon-extra${speedOpen ? ' open' : ''}`}
              onClick={(event) => setSpeedAnchor(event.currentTarget)}
            >
              {speed}x
              <ChevronDown size={12} />
            </button>
          </Tooltip>

          <Box className="mini-volume">
            <IconButton
              onClick={() => setMuted((value) => !value)}
              className="mini-icon-btn"
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <VolumeX size={16} /> : volume > 0.5 ? <Volume2 size={16} /> : <Volume1 size={16} />}
            </IconButton>
            <Slider
              value={muted ? 0 : volume}
              min={0}
              max={1}
              step={0.01}
              onChange={(_event, value) => {
                setMuted(false);
                setVolume(Array.isArray(value) ? value[0] : value);
              }}
              aria-label="Volume"
              className="mini-volume-slider"
            />
          </Box>

          <Tooltip title={queueOpen ? 'Hide queue' : 'Up next'}>
            <IconButton
              onClick={onToggleQueue}
              aria-label="Toggle queue"
              className={`mini-icon-btn mini-icon-extra${queueOpen ? ' control-on' : ''}`}
            >
              <ListMusic size={18} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box className="mini-secondary">
        <Tooltip title="Shuffle">
          <IconButton
            onClick={() => setShuffle((value) => !value)}
            className={`mini-icon-btn${shuffle ? ' control-on' : ''}`}
          >
            <Shuffle size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip title={`Repeat ${repeat}`}>
          <IconButton
            onClick={toggleRepeat}
            className={`mini-icon-btn${repeat !== 'off' ? ' control-on' : ''}`}
          >
            <Repeat size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Playback speed">
          <button
            type="button"
            className={`mini-speed-btn${speedOpen ? ' open' : ''}`}
            onClick={(event) => setSpeedAnchor(event.currentTarget)}
          >
            {speed}x
            <ChevronDown size={12} />
          </button>
        </Tooltip>
        <Box className="mini-secondary-volume">
          <IconButton
            onClick={() => setMuted((value) => !value)}
            className="mini-icon-btn"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX size={16} /> : volume > 0.5 ? <Volume2 size={16} /> : <Volume1 size={16} />}
          </IconButton>
          <Slider
            value={muted ? 0 : volume}
            min={0}
            max={1}
            step={0.01}
            onChange={(_event, value) => {
              setMuted(false);
              setVolume(Array.isArray(value) ? value[0] : value);
            }}
            aria-label="Volume"
            className="mini-secondary-volume-slider"
          />
        </Box>
        <Tooltip title={queueOpen ? 'Hide queue' : 'Up next'}>
          <IconButton
            onClick={onToggleQueue}
            aria-label="Toggle queue"
            className={`mini-icon-btn${queueOpen ? ' control-on' : ''}`}
          >
            <ListMusic size={18} />
          </IconButton>
        </Tooltip>
      </Box>

      <Menu
        anchorEl={speedAnchor}
        open={speedOpen}
        onClose={() => setSpeedAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        slotProps={{ paper: { className: 'speed-menu' } }}
      >
        {SPEED_OPTIONS.map((option) => (
          <MenuItem key={option} selected={option === speed} onClick={() => selectSpeed(option)}>
            {option}x{option === 1 ? ' (normal)' : ''}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

function playableSeekTime(
  audio: HTMLAudioElement,
  requestedTime: number,
  duration: number,
  loadedThrough: number,
): number {
  const clampedTime = Math.min(Math.max(requestedTime, 0), duration);
  if (navigator.onLine || clampedTime <= loadedThrough) {
    return clampedTime;
  }

  return Math.min(clampedTime, loadedThrough);
}

function locallyLoadedThrough(audio: HTMLAudioElement, loadedTime: number): number {
  return Math.max(loadedTime, contiguousBufferedEnd(audio));
}

function contiguousBufferedEnd(audio: HTMLAudioElement): number {
  if (audio.buffered.length === 0) {
    return 0;
  }

  let end = 0;
  for (let index = 0; index < audio.buffered.length; index += 1) {
    const start = audio.buffered.start(index);
    const rangeEnd = audio.buffered.end(index);
    if (start > end + 0.25) {
      break;
    }
    end = Math.max(end, rangeEnd);
  }

  return end;
}
