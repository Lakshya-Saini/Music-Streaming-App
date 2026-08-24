import { Box } from '@mui/material';
import { useState } from 'react';
import { AppMode } from '../App';
import { AppHeader } from '../components/AppHeader';
import { MusicPlayer } from '../components/MusicPlayer';
import { TrackList } from '../components/TrackList';
import { tracks } from '../data/tracks';
import { Track } from '../types';

interface HomePageProps {
  mode: AppMode;
  onToggleMode: () => void;
}

export function HomePage({ mode, onToggleMode }: HomePageProps) {
  const [activeTrack, setActiveTrack] = useState<Track>(tracks[0]);

  return (
    <Box className="app-page">
      <AppHeader mode={mode} onToggleMode={onToggleMode} />
      <Box component="main" className="home-layout">
        <TrackList
          tracks={tracks}
          activeTrackId={activeTrack.id}
          onSelectTrack={setActiveTrack}
        />
        <MusicPlayer tracks={tracks} activeTrack={activeTrack} onTrackChange={setActiveTrack} />
      </Box>
    </Box>
  );
}
