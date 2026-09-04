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
      <Box className="section-heading-row">
        <Box>
          <Typography component="h2" className="section-title">
            Library
          </Typography>
          <Typography className="section-subtitle">
            {loading ? 'Loading songs from S3-backed catalog' : `${tracks.length} songs available`}
          </Typography>
        </Box>
      </Box>

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
                <span>{formatDuration(track.duration)}</span>
                <span>{track.bitrate}k</span>
              </span>
            </button>
          );
        })}

        {tracks.length === 0 && (
          <Box className="empty-state">
            <Typography className="empty-title">No songs ready</Typography>
            <Typography className="section-subtitle">Completed uploads will appear here.</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
