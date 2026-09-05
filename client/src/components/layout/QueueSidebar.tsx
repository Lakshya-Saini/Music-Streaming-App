import { Box, IconButton, Typography } from '@mui/material';
import { ListMusic, X } from 'lucide-react';
import { Track } from '../../types';
import { formatDuration } from '../../utils/format';

interface QueueSidebarProps {
  open: boolean;
  tracks: Track[];
  activeTrack: Track | null;
  onSelectTrack: (track: Track) => void;
  onClose: () => void;
}

export function QueueSidebar({ open, tracks, activeTrack, onSelectTrack, onClose }: QueueSidebarProps) {
  const activeIndex = activeTrack ? tracks.findIndex((track) => track.id === activeTrack.id) : -1;
  const upcoming =
    activeIndex === -1 ? tracks : [...tracks.slice(activeIndex + 1), ...tracks.slice(0, activeIndex + 1)];

  return (
    <>
      {open && <Box className="queue-backdrop" onClick={onClose} />}
      <Box component="aside" className={`queue-sidebar${open ? ' open' : ''}`} aria-label="Up next" aria-hidden={!open}>
        <Box className="queue-sidebar-header">
          <span>Up next</span>
          <IconButton size="small" onClick={onClose} aria-label="Close queue" className="mini-icon-btn">
            <X size={18} />
          </IconButton>
        </Box>
        <Box className="queue-sidebar-list">
          {upcoming.length === 0 ? (
            <Box className="queue-empty">
              <ListMusic size={22} />
              <Typography className="section-subtitle">Nothing queued yet.</Typography>
            </Box>
          ) : (
            upcoming.map((track) => (
              <button
                key={track.id}
                type="button"
                className={`queue-item${track.id === activeTrack?.id ? ' active' : ''}`}
                onClick={() => onSelectTrack(track)}
              >
                <img src={track.cover} alt="" className="queue-item-thumb" />
                <span className="queue-item-copy">
                  <span className="queue-item-title">{track.title}</span>
                  <span className="queue-item-artist">{track.artist}</span>
                </span>
                <span className="queue-item-duration">{formatDuration(track.duration)}</span>
              </button>
            ))
          )}
        </Box>
      </Box>
    </>
  );
}
