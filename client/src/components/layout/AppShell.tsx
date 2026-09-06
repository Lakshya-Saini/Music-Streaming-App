import { Box, Typography } from '@mui/material';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import type { AppMode } from '../../App';
import { useLibrary } from '../../state/LibraryContext';
import { MusicPlayer } from '../MusicPlayer';
import { Navbar } from './Navbar';
import { QueueSidebar } from './QueueSidebar';
import { MobileTabBar, Sidebar } from './Sidebar';

interface AppShellProps {
  mode: AppMode;
  onToggleMode: () => void;
}

export function AppShell({ mode, onToggleMode }: AppShellProps) {
  const { tracks, activeTrack, playTrack, loading, errorMessage, reload } = useLibrary();
  const [queueOpen, setQueueOpen] = useState(false);

  return (
    <Box className="app-shell">
      <Navbar />
      <Box className="app-body">
        <Sidebar mode={mode} onToggleMode={onToggleMode} />
        <Box component="main" className="app-main">
          <Outlet />
        </Box>
        <QueueSidebar
          open={queueOpen}
          tracks={tracks}
          activeTrack={activeTrack}
          onSelectTrack={playTrack}
          onClose={() => setQueueOpen(false)}
        />
      </Box>
      <MobileTabBar />

      {activeTrack ? (
        <MusicPlayer
          tracks={tracks}
          activeTrack={activeTrack}
          onTrackChange={playTrack}
          queueOpen={queueOpen}
          onToggleQueue={() => setQueueOpen((value) => !value)}
        />
      ) : (
        <Box className="player-dock empty-dock">
          <Typography className="empty-dock-text">
            {loading
              ? 'Loading your library...'
              : errorMessage ?? 'No playable songs yet. Upload a track to get started.'}
          </Typography>
          {!loading && (
            <button className="text-control" type="button" onClick={() => void reload()}>
              <RefreshCw size={14} />
              Refresh
            </button>
          )}
        </Box>
      )}
    </Box>
  );
}
