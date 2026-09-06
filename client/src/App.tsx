import { CssBaseline, ThemeProvider } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { OfflineGuard } from './components/OfflineGuard';
import { BrowsePage } from './pages/BrowsePage';
import { HomePage } from './pages/HomePage';
import { PlaylistsPage } from './pages/PlaylistsPage';
import { UploadPage } from './pages/UploadPage';
import { LibraryProvider } from './state/LibraryContext';
import { createAppTheme } from './theme';

export type AppMode = 'light' | 'dark';

export function App() {
  const [mode, setMode] = useState<AppMode>(() => {
    const saved = window.localStorage.getItem('sonora-theme');
    return saved === 'dark' || saved === 'light' ? saved : 'dark';
  });

  const theme = useMemo(() => createAppTheme(mode), [mode]);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    window.localStorage.setItem('sonora-theme', mode);
  }, [mode]);

  const toggleMode = () => setMode((current) => (current === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <OfflineGuard />
      <LibraryProvider>
        <Routes>
          <Route element={<AppShell mode={mode} onToggleMode={toggleMode} />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/playlists" element={<PlaylistsPage />} />
            <Route path="/upload" element={<UploadPage />} />
          </Route>
        </Routes>
      </LibraryProvider>
    </ThemeProvider>
  );
}
