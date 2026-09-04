import { Box, Button, Typography } from '@mui/material';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppMode } from '../App';
import { listReadyTracks } from '../api/tracks';
import { AppHeader } from '../components/AppHeader';
import { MusicPlayer } from '../components/MusicPlayer';
import { TrackList } from '../components/TrackList';
import { Track } from '../types';

interface HomePageProps {
  mode: AppMode;
  onToggleMode: () => void;
}

export function HomePage({ mode, onToggleMode }: HomePageProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [activeTrack, setActiveTrack] = useState<Track | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadTracks = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const readyTracks = await listReadyTracks();
      setTracks(readyTracks);
      setActiveTrack((current) => {
        if (current && readyTracks.some((track) => track.id === current.id)) {
          return current;
        }
        return readyTracks[0] ?? null;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not load songs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTracks();
  }, []);

  return (
    <Box className="app-page">
      <AppHeader mode={mode} onToggleMode={onToggleMode} />
      <Box component="main" className="home-layout">
        <TrackList
          tracks={tracks}
          activeTrackId={activeTrack?.id}
          onSelectTrack={setActiveTrack}
          loading={loading}
        />
        {activeTrack ? (
          <MusicPlayer tracks={tracks} activeTrack={activeTrack} onTrackChange={setActiveTrack} />
        ) : (
          <Box className="player-shell empty-player">
            <Typography component="h2" className="section-title">
              No playable songs yet
            </Typography>
            <Typography className="section-subtitle">
              Upload a WAV file, wait for processing to finish, then refresh the library.
            </Typography>
            {errorMessage && <Typography className="upload-error">{errorMessage}</Typography>}
            <Button variant="contained" startIcon={<RefreshCw size={18} />} onClick={loadTracks}>
              Refresh library
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}
