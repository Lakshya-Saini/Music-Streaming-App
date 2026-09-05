import { Play } from 'lucide-react';
import { Track } from '../types';

interface TrackCardProps {
  track: Track;
  active?: boolean;
  onSelect: (track: Track) => void;
}

export function TrackCard({ track, active = false, onSelect }: TrackCardProps) {
  return (
    <button
      type="button"
      className={`track-card${active ? ' active' : ''}`}
      onClick={() => onSelect(track)}
    >
      <span className="track-card-art">
        <img src={track.cover} alt="" loading="lazy" />
        <span className="track-card-play">
          <Play size={18} fill="currentColor" />
        </span>
      </span>
      <span className="track-card-title">{track.title}</span>
      <span className="track-card-artist">{track.artist}</span>
    </button>
  );
}
