import { Box, Typography } from '@mui/material';
import { Compass, Home, ListMusic, Moon, Sun, UploadCloud } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { AppMode } from '../../App';
import { useAuth } from '../../state/AuthContext';

const NAV_LINKS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/browse', label: 'Browse', icon: Compass, end: false },
  { to: '/playlists', label: 'Playlists', icon: ListMusic, end: false },
];

const ADMIN_LINK = { to: '/upload', label: 'Upload', icon: UploadCloud, end: false };

interface SidebarProps {
  mode: AppMode;
  onToggleMode: () => void;
}

export function Sidebar({ mode, onToggleMode }: SidebarProps) {
  const { isAdmin } = useAuth();
  const links = isAdmin ? [...NAV_LINKS, ADMIN_LINK] : NAV_LINKS;

  return (
    <Box component="nav" className="sidebar" aria-label="Primary">
      <Typography className="sidebar-heading">Menu</Typography>
      <Box className="sidebar-links">
        {links.map(({ to, label, icon: Icon, end }) => (
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

      <button type="button" className="sidebar-theme-toggle" onClick={onToggleMode}>
        {mode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        <span>{mode === 'dark' ? 'Light mode' : 'Dark mode'}</span>
      </button>
    </Box>
  );
}

export function MobileTabBar() {
  const { isAdmin } = useAuth();
  const links = isAdmin ? [...NAV_LINKS, ADMIN_LINK] : NAV_LINKS;

  return (
    <Box component="nav" className="mobile-tab-bar" aria-label="Primary">
      {links.map(({ to, label, icon: Icon, end }) => (
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
