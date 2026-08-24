import { Box, IconButton, Slider, Tooltip, Typography } from '@mui/material';
import {
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

interface MusicPlayerProps {
  tracks: Track[];
  activeTrack: Track;
  onTrackChange: (track: Track) => void;
}

type RepeatMode = 'off' | 'one' | 'all';

export function MusicPlayer({ tracks, activeTrack, onTrackChange }: MusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(activeTrack.duration);
  const [volume, setVolume] = useState(0.78);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('all');
  const [speed, setSpeed] = useState(1);

  const activeIndex = useMemo(
    () => tracks.findIndex((track) => track.id === activeTrack.id),
    [activeTrack.id, tracks],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
    audio.playbackRate = speed;
  }, [muted, speed, volume]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(activeTrack.duration);
    if (playing) {
      void audioRef.current?.play();
    }
  }, [activeTrack, playing]);

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
    await audio.play();
    setPlaying(true);
  };

  const seek = (_event: Event, value: number | number[]) => {
    const nextTime = Array.isArray(value) ? value[0] : value;
    if (audioRef.current) {
      audioRef.current.currentTime = nextTime;
    }
    setCurrentTime(nextTime);
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
        src={activeTrack.streamUrl}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || activeTrack.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
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
          </Box>
        </Box>
      </Box>

      <Box className="timeline-block">
        <Slider
          value={Math.min(currentTime, duration || activeTrack.duration)}
          min={0}
          max={duration || activeTrack.duration}
          onChange={seek}
          aria-label="Playback progress"
        />
        <Box className="time-row">
          <span>{formatDuration(currentTime)}</span>
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
