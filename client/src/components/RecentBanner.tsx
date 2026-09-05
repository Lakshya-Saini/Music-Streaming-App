import { Box, Button, Typography } from '@mui/material';
import { Play, Sparkles } from 'lucide-react';
import { Track } from '../types';
import { formatDuration } from '../utils/format';
import { languageLabel } from '../utils/languages';

interface RecentBannerProps {
  track: Track;
  onPlay: (track: Track) => void;
}

export function RecentBanner({ track, onPlay }: RecentBannerProps) {
  return (
    <Box className="recent-banner">
      <Box className="recent-banner-art">
        <img src={track.cover} alt="" />
      </Box>
      <Box className="recent-banner-copy">
        <Box className="recent-banner-eyebrow">
          <Sparkles size={16} />
          <span>Recently added</span>
        </Box>
        <Typography component="h1" className="recent-banner-title">
          {track.title}
        </Typography>
        <Typography className="recent-banner-artist">{track.artist}</Typography>
        <Box className="metadata-line">
          <span>{track.album}</span>
          <span>{track.genre}</span>
          {track.language && <span>{languageLabel(track.language)}</span>}
          <span>{formatDuration(track.duration)}</span>
        </Box>
        <Button
          variant="contained"
          size="large"
          startIcon={<Play size={18} fill="currentColor" />}
          onClick={() => onPlay(track)}
          className="recent-banner-play"
        >
          Play now
        </Button>
      </Box>
    </Box>
  );
}
