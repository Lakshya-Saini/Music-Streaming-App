import { Box, Typography } from '@mui/material';
import { Compass, Home, ListMusic, UploadCloud } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const NAV_LINKS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/browse', label: 'Browse', icon: Compass, end: false },
  { to: '/playlists', label: 'Playlists', icon: ListMusic, end: false },
  { to: '/upload', label: 'Upload', icon: UploadCloud, end: false },
];

export function Sidebar() {
  return (
    <Box component="nav" className="sidebar" aria-label="Primary">
      <Typography className="sidebar-heading">Menu</Typography>
      <Box className="sidebar-links">
        {NAV_LINKS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
          >
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </Box>
    </Box>
  );
}

export function MobileTabBar() {
  return (
    <Box component="nav" className="mobile-tab-bar" aria-label="Primary">
      {NAV_LINKS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `mobile-tab${isActive ? ' active' : ''}`}
        >
          <Icon size={20} />
          <span>{label}</span>
        </NavLink>
      ))}
    </Box>
  );
}
