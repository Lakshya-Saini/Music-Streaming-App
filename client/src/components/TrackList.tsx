import { Box, Typography } from '@mui/material';
import { Track } from '../types';
import { formatDuration } from '../utils/format';

interface TrackListProps {
  tracks: Track[];
  activeTrackId?: string;
  onSelectTrack: (track: Track) => void;
  loading?: boolean;
}

export function TrackList({ tracks, activeTrackId, onSelectTrack, loading = false }: TrackListProps) {
  return (
    <Box className="track-list-shell">
      <Box className="track-list">
        {tracks.map((track) => {
          const active = track.id === activeTrackId;
          return (
            <button
              key={track.id}
              className={`track-row ${active ? 'active' : ''}`}
              onClick={() => onSelectTrack(track)}
              type="button"
            >
              <img src={track.cover} alt="" className="track-thumb" />
              <span className="track-copy">
                <span className="track-title">{track.title}</span>
                <span className="track-meta">
                  {track.artist} · {track.album}
                </span>
              </span>
              <span className="track-side">
                <span className="track-genre-chip">{track.genre}</span>
                <span>{formatDuration(track.duration)}</span>
              </span>
            </button>
          );
        })}

        {tracks.length === 0 && (
          <Box className="empty-state">
            <Typography className="empty-title">{loading ? 'Loading songs...' : 'No songs found'}</Typography>
            <Typography className="section-subtitle">
              {loading ? 'Fetching your catalog.' : 'Try a different filter or upload a new track.'}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
