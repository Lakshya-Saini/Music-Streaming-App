import { Box, ClickAwayListener, IconButton, InputBase, Menu, MenuItem, Typography } from '@mui/material';
import { ChevronDown, LogOut, Music2, Play, Search, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useLibrary } from '../../state/LibraryContext';
import { formatDuration } from '../../utils/format';
import { languageLabel } from '../../utils/languages';

export function Navbar() {
  const { searchQuery, setSearchQuery, searchResults, playTrack } = useLibrary();
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [focused, setFocused] = useState(false);
  const [profileAnchor, setProfileAnchor] = useState<HTMLElement | null>(null);
  const showDropdown = focused && searchQuery.trim().length > 0;

  const handleLogout = () => {
    setProfileAnchor(null);
    logout();
    navigate('/');
  };

  const handleSelect = (trackId: string) => {
    const track = searchResults.find((item) => item.id === trackId);
    if (!track) return;
    playTrack(track);
    setSearchQuery('');
    setFocused(false);
  };

  return (
    <Box component="header" className="navbar">
      <Link to="/" className="brand-lockup">
        <Box className="brand-mark">
          <Music2 size={20} />
        </Box>
        <Typography component="span" className="brand-name">
          Sonora
        </Typography>
      </Link>

      <ClickAwayListener onClickAway={() => setFocused(false)}>
        <Box className="search-wrap">
          <Box className={`search-field${focused ? ' focused' : ''}`}>
            <Search size={18} className="search-icon" />
            <InputBase
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onFocus={() => setFocused(true)}
              placeholder="Search songs, artists, albums..."
              className="search-input"
              inputProps={{ 'aria-label': 'Search songs' }}
            />
            {searchQuery && (
              <IconButton
                size="small"
                className="search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <X size={16} />
              </IconButton>
            )}
          </Box>

          {showDropdown && (
            <Box className="search-dropdown" role="listbox">
              {searchResults.length === 0 ? (
                <Box className="search-empty">
                  <Typography className="search-empty-title">No songs found</Typography>
                  <Typography className="section-subtitle">
                    We couldn't find "{searchQuery}" in the library. Try a different title or artist.
                  </Typography>
                </Box>
              ) : (
                searchResults.slice(0, 8).map((track) => (
                  <button
                    key={track.id}
                    type="button"
                    className="search-result-row"
                    onClick={() => handleSelect(track.id)}
                  >
                    <img src={track.cover} alt="" className="search-result-thumb" />
                    <span className="search-result-copy">
                      <span className="search-result-title">{track.title}</span>
                      <span className="search-result-meta">
                        {track.artist} · {track.album}
                      </span>
                    </span>
                    <span className="search-result-side">
                      <span className="search-result-chip">{track.genre}</span>
                      <span className="search-result-chip">{languageLabel(track.language)}</span>
                      <span className="search-result-year">{track.year}</span>
                      <span className="search-result-duration">{formatDuration(track.duration)}</span>
                      <span className="search-result-play">
                        <Play size={14} />
                      </span>
                    </span>
                  </button>
                ))
              )}
            </Box>
          )}
        </Box>
      </ClickAwayListener>

      {isAuthenticated && user ? (
        <>
          <button
            type="button"
            className={`navbar-profile${Boolean(profileAnchor) ? ' open' : ''}`}
            onClick={(event) => setProfileAnchor(event.currentTarget)}
          >
            <span className="navbar-avatar">{user.name.charAt(0).toUpperCase()}</span>
            <span className="navbar-profile-name">{user.name}</span>
            <ChevronDown size={14} />
          </button>
          <Menu
            anchorEl={profileAnchor}
            open={Boolean(profileAnchor)}
            onClose={() => setProfileAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { className: 'speed-menu navbar-profile-menu' } }}
          >
            <Box className="navbar-profile-menu-header">
              <Typography className="navbar-profile-menu-name">{user.name}</Typography>
              <Typography className="section-subtitle">{user.email}</Typography>
              {user.role === 'admin' && (
                <span className="navbar-profile-badge">
                  <ShieldCheck size={12} />
                  Admin
                </span>
              )}
            </Box>
            <MenuItem onClick={handleLogout}>
              <LogOut size={16} />
              <span>Log out</span>
            </MenuItem>
          </Menu>
        </>
      ) : (
        <Link to="/login" className="navbar-login-btn">
          Log in
        </Link>
      )}
    </Box>
  );
}
