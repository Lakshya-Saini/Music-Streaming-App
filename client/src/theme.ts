import { createTheme } from '@mui/material/styles';
import type { AppMode } from './App';

export const createAppTheme = (mode: AppMode) =>
  createTheme({
    palette: {
      mode,
      primary: {
        main: mode === 'dark' ? '#6d8bff' : '#3452e1',
      },
      secondary: {
        main: mode === 'dark' ? '#3fc7ac' : '#1a9c84',
      },
      background: {
        default: mode === 'dark' ? '#0e1015' : '#f6f7fb',
        paper: mode === 'dark' ? '#161922' : '#ffffff',
      },
      text: {
        primary: mode === 'dark' ? '#eef0f6' : '#161a23',
        secondary: mode === 'dark' ? '#98a0b3' : '#5c6478',
      },
    },
    shape: {
      borderRadius: 10,
    },
    typography: {
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h1: { fontWeight: 750, letterSpacing: -0.2 },
      h2: { fontWeight: 720, letterSpacing: -0.2 },
      h3: { fontWeight: 700, letterSpacing: -0.1 },
      h4: { fontWeight: 680, letterSpacing: 0 },
      h5: { fontWeight: 650, letterSpacing: 0 },
      h6: { fontWeight: 650, letterSpacing: 0 },
      button: { fontWeight: 650, textTransform: 'none', letterSpacing: 0 },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
    },
  });
