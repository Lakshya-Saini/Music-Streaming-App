import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material';
import { Moon, Music2, Sun, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AppMode } from '../App';

interface AppHeaderProps {
  mode: AppMode;
  onToggleMode: () => void;
}

export function AppHeader({ mode, onToggleMode }: AppHeaderProps) {
  return (
    <Box component="header" className="app-header">
      <Box className="brand-lockup">
        <Box className="brand-mark">
          <Music2 size={22} />
        </Box>
        <Typography component="h1" className="brand-name">
          Sonora
        </Typography>
      </Box>

      <Box className="header-actions">
        <Button component={Link} to="/upload" variant="contained" startIcon={<Upload size={18} />}>
          Upload
        </Button>
        <Tooltip title={mode === 'dark' ? 'Use light mode' : 'Use dark mode'}>
          <IconButton className="theme-toggle" onClick={onToggleMode} aria-label="Toggle dark mode">
            {mode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
