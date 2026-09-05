import { Box, Typography } from '@mui/material';
import { ListMusic } from 'lucide-react';

export function PlaylistsPage() {
  return (
    <Box className="page playlists-page">
      <Box className="page-heading-row">
        <Box>
          <Typography component="h1" className="page-title">
            My Playlists
          </Typography>
          <Typography className="section-subtitle">Organize your favorite songs into collections.</Typography>
        </Box>
      </Box>

      <Box className="empty-state playlists-empty-state">
        <Box className="empty-state-icon">
          <ListMusic size={28} />
        </Box>
        <Typography className="empty-title">Playlists are coming soon</Typography>
        <Typography className="section-subtitle">
          You'll be able to group your favorite tracks into custom playlists here.
        </Typography>
      </Box>
    </Box>
  );
}
