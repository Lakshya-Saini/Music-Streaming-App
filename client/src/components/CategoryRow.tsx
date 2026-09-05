import { Box, IconButton, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef } from 'react';
import { Track } from '../types';
import { TrackCard } from './TrackCard';

interface CategoryRowProps {
  title: string;
  tracks: Track[];
  activeTrackId?: string;
  onSelectTrack: (track: Track) => void;
}

export function CategoryRow({ title, tracks, activeTrackId, onSelectTrack }: CategoryRowProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollByAmount = (direction: 1 | -1) => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * node.clientWidth * 0.85, behavior: 'smooth' });
  };

  if (tracks.length === 0) {
    return null;
  }

  return (
    <Box className="category-row" component="section">
      <Box className="category-row-heading">
        <Typography component="h2" className="category-row-title">
          {title}
        </Typography>
        <Box className="category-row-nav">
          <IconButton size="small" onClick={() => scrollByAmount(-1)} aria-label={`Scroll ${title} left`}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton size="small" onClick={() => scrollByAmount(1)} aria-label={`Scroll ${title} right`}>
            <ChevronRight size={18} />
          </IconButton>
        </Box>
      </Box>
      <Box className="category-row-track-scroll" ref={scrollRef}>
        {tracks.map((track) => (
          <TrackCard
            key={track.id}
            track={track}
            active={track.id === activeTrackId}
            onSelect={onSelectTrack}
          />
        ))}
      </Box>
    </Box>
  );
}
