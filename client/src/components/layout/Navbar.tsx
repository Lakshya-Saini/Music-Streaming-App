import { Box, ClickAwayListener, IconButton, InputBase, Tooltip, Typography } from '@mui/material';
import { Moon, Music2, Play, Search, Sun, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppMode } from '../../App';
import { useLibrary } from '../../state/LibraryContext';
import { formatDuration } from '../../utils/format';
import { languageLabel } from '../../utils/languages';

interface NavbarProps {
  mode: AppMode;
  onToggleMode: () => void;
}

export function Navbar({ mode, onToggleMode }: NavbarProps) {
  const { searchQuery, setSearchQuery, searchResults, playTrack } = useLibrary();
  const [focused, setFocused] = useState(false);
  const showDropdown = focused && searchQuery.trim().length > 0;

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

      <Tooltip title={mode === 'dark' ? 'Use light mode' : 'Use dark mode'}>
        <IconButton className="theme-toggle" onClick={onToggleMode} aria-label="Toggle dark mode">
          {mode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}
