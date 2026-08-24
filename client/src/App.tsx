import { CssBaseline, ThemeProvider } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { UploadPage } from './pages/UploadPage';
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
      <Routes>
        <Route path="/" element={<HomePage mode={mode} onToggleMode={toggleMode} />} />
        <Route path="/upload" element={<UploadPage mode={mode} onToggleMode={toggleMode} />} />
      </Routes>
    </ThemeProvider>
  );
}
