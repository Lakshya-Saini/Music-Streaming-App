import { createTheme } from '@mui/material/styles';
import { AppMode } from './App';

export const createAppTheme = (mode: AppMode) =>
  createTheme({
    palette: {
      mode,
      primary: {
        main: mode === 'dark' ? '#ff375f' : '#fa233b',
      },
      secondary: {
        main: mode === 'dark' ? '#ff9f0a' : '#ff7a00',
      },
      background: {
        default: mode === 'dark' ? '#050506' : '#f5f5f7',
        paper: mode === 'dark' ? '#151517' : '#ffffff',
      },
      text: {
        primary: mode === 'dark' ? '#f5f5f7' : '#1d1d1f',
        secondary: mode === 'dark' ? '#a1a1a6' : '#6e6e73',
      },
    },
    shape: {
      borderRadius: 8,
    },
    typography: {
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h1: { fontWeight: 800, letterSpacing: 0 },
      h2: { fontWeight: 760, letterSpacing: 0 },
      h3: { fontWeight: 740, letterSpacing: 0 },
      h4: { fontWeight: 720, letterSpacing: 0 },
      h5: { fontWeight: 700, letterSpacing: 0 },
      h6: { fontWeight: 700, letterSpacing: 0 },
      button: { fontWeight: 700, textTransform: 'none', letterSpacing: 0 },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
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
