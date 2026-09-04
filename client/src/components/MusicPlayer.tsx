import { Box, IconButton, Slider, Tooltip, Typography } from '@mui/material';
import {
  AlertTriangle,
  ListMusic,
  Maximize2,
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
import { Track } from '../types';
import { formatDuration } from '../utils/format';
import { streamingUrlFor } from '../api/tracks';
import { preloadStreamPrefix } from '../utils/streamCache';

interface MusicPlayerProps {
  tracks: Track[];
  activeTrack: Track;
  onTrackChange: (track: Track) => void;
}

type RepeatMode = 'off' | 'one' | 'all';

export function MusicPlayer({ tracks, activeTrack, onTrackChange }: MusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seekRequestRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loadedTime, setLoadedTime] = useState(0);
  const [duration, setDuration] = useState(activeTrack.duration);
  const [volume, setVolume] = useState(0.78);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('all');
  const [speed, setSpeed] = useState(1);
  const [online, setOnline] = useState(navigator.onLine);
  const [preloadingSeek, setPreloadingSeek] = useState(false);
  const [playerMessage, setPlayerMessage] = useState<string | null>(null);

  const activeIndex = useMemo(
    () => tracks.findIndex((track) => track.id === activeTrack.id),
    [activeTrack.id, tracks],
  );
  const networkProfile = useMemo(() => getNetworkProfile(), []);
  const loadedPercent = duration > 0 ? Math.min(100, (loadedTime / duration) * 100) : 0;
  const audioSource = streamingUrlFor(activeTrack.id, networkProfile);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
    audio.playbackRate = speed;
  }, [muted, speed, volume]);

  useEffect(() => {
    setCurrentTime(0);
    setLoadedTime(0);
    setDuration(activeTrack.duration);
    setPlayerMessage(null);
  }, [activeTrack]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      setPlayerMessage(null);
    };
    const handleOffline = () => {
      setOnline(false);
      setPlayerMessage('You are offline. Already streamed audio remains playable.');
    };

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

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    if (!navigator.onLine && audio.currentTime > locallyLoadedThrough(audio, loadedTime)) {
      setOnline(false);
      setPlayerMessage('You are offline. This position has not been streamed yet.');
      return;
    }

    try {
      await audio.play();
      setPlaying(true);
      setPlayerMessage(null);
    } catch {
      setPlaying(false);
      setPlayerMessage('Playback could not start. Check the network request for the stream endpoint.');
    }
  };

  const seek = (_event: Event, value: number | number[]) => {
    const requestedTime = Array.isArray(value) ? value[0] : value;
    void seekTo(requestedTime);
  };

  const seekTo = async (requestedTime: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const trackDuration = duration || activeTrack.duration;
    let loadedThrough = locallyLoadedThrough(audio, loadedTime);
    const seekRequestId = seekRequestRef.current + 1;
    seekRequestRef.current = seekRequestId;

    if (navigator.onLine && requestedTime > loadedThrough + 1) {
      setPreloadingSeek(true);
      setPlayerMessage('Loading skipped audio...');
      try {
        const preloaded = await preloadStreamPrefix(
          activeTrack,
          audioSource,
          networkProfile,
          requestedTime,
          trackDuration,
        );
        if (seekRequestRef.current !== seekRequestId) {
          return;
        }
        if (preloaded) {
          loadedThrough = Math.max(loadedThrough, requestedTime);
          setLoadedTime((current) => Math.max(current, requestedTime));
          setPlayerMessage(null);
        }
      } catch {
        if (seekRequestRef.current !== seekRequestId) {
          return;
        }
        setPlayerMessage('Could not preload the skipped audio. Streaming from the new position.');
      } finally {
        if (seekRequestRef.current === seekRequestId) {
          setPreloadingSeek(false);
        }
      }
    }

    const nextTime = playableSeekTime(audio, requestedTime, trackDuration, loadedThrough);
    if (!navigator.onLine && nextTime < requestedTime) {
      setPlayerMessage('That part has not been streamed yet. Reconnect to jump further.');
    }
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const handleTimeUpdate = (audio: HTMLAudioElement) => {
    if (!navigator.onLine && audio.currentTime + 0.5 > locallyLoadedThrough(audio, loadedTime)) {
      audio.pause();
      setOnline(false);
      setPlaying(false);
      setPlayerMessage('You reached the end of the streamed audio. Reconnect to continue.');
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
    setPlayerMessage('Streaming failed. The track may still be processing, the connection may be offline, or the S3 object may be unavailable.');
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

  return (
    <Box className="player-shell">
      <audio
        ref={audioRef}
        src={audioSource}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || activeTrack.duration)}
        onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget)}
        onProgress={updateBufferedTime}
        onCanPlay={updateBufferedTime}
        onWaiting={() => setPlayerMessage('Buffering audio...')}
        onPlaying={() => {
          setPlaying(true);
          setPlayerMessage(null);
        }}
        onPause={() => setPlaying(false)}
        onError={handlePlayerError}
        onEnded={handleEnded}
      />

      <Box className="now-playing">
        <Box className="cover-wrap" style={{ backgroundColor: activeTrack.color }}>
          <img src={activeTrack.cover} alt="" className="cover-art" />
        </Box>
        <Box className="now-copy">
          <Typography component="h2">{activeTrack.title}</Typography>
          <Typography>{activeTrack.artist}</Typography>
          <Box className="metadata-line">
            <span>{activeTrack.album}</span>
            <span>{activeTrack.genre}</span>
            <span>{activeTrack.year}</span>
            <span>{networkProfile.toUpperCase()} auto</span>
            <span>{online ? 'Online' : 'Offline'}</span>
          </Box>
        </Box>
      </Box>

      {playerMessage && (
        <Box className="player-message">
          <AlertTriangle size={18} />
          <span>{playerMessage}</span>
        </Box>
      )}

      <Box className="timeline-block">
        <Box className="stream-meter">
          <Box className="buffer-track">
            <span style={{ width: `${loadedPercent}%` }} />
          </Box>
          <Slider
            value={Math.min(currentTime, duration || activeTrack.duration)}
            min={0}
            max={duration || activeTrack.duration}
            onChange={seek}
            aria-label="Playback progress"
          />
        </Box>
        <Box className="time-row">
          <span>{formatDuration(currentTime)}</span>
          <span>{preloadingSeek ? 'Loading seek...' : `Loaded ${Math.round(loadedPercent)}%`}</span>
          <span>{formatDuration(duration || activeTrack.duration)}</span>
        </Box>
      </Box>

      <Box className="transport-row">
        <Tooltip title="Shuffle">
          <IconButton className={shuffle ? 'control-on' : ''} onClick={() => setShuffle((value) => !value)}>
            <Shuffle size={20} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Previous">
          <IconButton onClick={() => selectRelativeTrack(-1)}>
            <SkipBack size={22} />
          </IconButton>
        </Tooltip>
        <IconButton className="play-button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={28} /> : <Play size={28} />}
        </IconButton>
        <Tooltip title="Next">
          <IconButton onClick={() => selectRelativeTrack(1)}>
            <SkipForward size={22} />
          </IconButton>
        </Tooltip>
        <Tooltip title={`Repeat ${repeat}`}>
          <IconButton className={repeat !== 'off' ? 'control-on' : ''} onClick={toggleRepeat}>
            <Repeat size={20} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box className="utility-grid">
        <Box className="utility-panel">
          <Box className="mini-label">
            {muted ? <VolumeX size={18} /> : volume > 0.5 ? <Volume2 size={18} /> : <Volume1 size={18} />}
            <span>Volume</span>
          </Box>
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
          />
          <button className="text-control" type="button" onClick={() => setMuted((value) => !value)}>
            {muted ? 'Unmute' : 'Mute'}
          </button>
        </Box>

        <Box className="utility-panel">
          <Box className="mini-label">
            <Maximize2 size={18} />
            <span>Playback</span>
          </Box>
          <Box className="speed-row">
            {[0.75, 1, 1.25, 1.5].map((option) => (
              <button
                key={option}
                className={speed === option ? 'speed active' : 'speed'}
                type="button"
                onClick={() => setSpeed(option)}
              >
                {option}x
              </button>
            ))}
          </Box>
        </Box>
      </Box>

      <Box className="queue-panel">
        <Box className="mini-label">
          <ListMusic size={18} />
          <span>Up next</span>
        </Box>
        {tracks.slice(0, 4).map((track) => (
          <button
            className={`queue-item ${track.id === activeTrack.id ? 'active' : ''}`}
            key={track.id}
            onClick={() => onTrackChange(track)}
            type="button"
          >
            <span>{track.title}</span>
            <span>{formatDuration(track.duration)}</span>
          </button>
        ))}
      </Box>
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

function getNetworkProfile(): string {
  const connection = (
    navigator as Navigator & {
      connection?: { effectiveType?: string };
      mozConnection?: { effectiveType?: string };
      webkitConnection?: { effectiveType?: string };
    }
  ).connection;

  const effectiveType =
    connection?.effectiveType ??
    (navigator as Navigator & { mozConnection?: { effectiveType?: string } }).mozConnection
      ?.effectiveType ??
    (navigator as Navigator & { webkitConnection?: { effectiveType?: string } }).webkitConnection
      ?.effectiveType;

  if (
    effectiveType === 'slow-2g' ||
    effectiveType === '2g' ||
    effectiveType === '3g' ||
    effectiveType === '4g'
  ) {
    return effectiveType;
  }

  return 'unknown';
}
