import { Box, InputBase, MenuItem, Popover, Select, Typography } from '@mui/material';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { TrackList } from '../components/TrackList';
import { useLibrary } from '../state/LibraryContext';
import { languageLabel } from '../utils/languages';

const ALL = 'all';

interface Filters {
  genre: string;
  artist: string;
  album: string;
  year: string;
  language: string;
}

const INITIAL_FILTERS: Filters = { genre: ALL, artist: ALL, album: ALL, year: ALL, language: ALL };

const FILTER_LABELS: Record<keyof Filters, string> = {
  genre: 'Genre',
  artist: 'Artist',
  album: 'Album',
  year: 'Year',
  language: 'Language',
};

export function BrowsePage() {
  const { tracks, loading, activeTrack, playTrack } = useLibrary();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);

  const genres = useMemo(
    () => Array.from(new Set(tracks.map((track) => track.genre).filter(Boolean))).sort(),
    [tracks],
  );
  const artists = useMemo(
    () => Array.from(new Set(tracks.map((track) => track.artist).filter(Boolean))).sort(),
    [tracks],
  );
  const albums = useMemo(
    () => Array.from(new Set(tracks.map((track) => track.album).filter(Boolean))).sort(),
    [tracks],
  );
  const years = useMemo(
    () => Array.from(new Set(tracks.map((track) => track.year))).sort((a, b) => b - a),
    [tracks],
  );
  const languages = useMemo(
    () =>
      Array.from(new Set(tracks.map((track) => track.language).filter((value): value is string => Boolean(value)))).sort(),
    [tracks],
  );

  const filteredTracks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tracks.filter((track) => {
      if (filters.genre !== ALL && track.genre !== filters.genre) return false;
      if (filters.artist !== ALL && track.artist !== filters.artist) return false;
      if (filters.album !== ALL && track.album !== filters.album) return false;
      if (filters.year !== ALL && String(track.year) !== filters.year) return false;
      if (filters.language !== ALL && track.language !== filters.language) return false;
      if (!normalizedQuery) return true;
      return (
        track.title.toLowerCase().includes(normalizedQuery) ||
        track.artist.toLowerCase().includes(normalizedQuery) ||
        track.album.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [tracks, query, filters]);

  const activeFilters = (Object.keys(filters) as (keyof Filters)[]).filter((key) => filters[key] !== ALL);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearFilter = (key: keyof Filters) => updateFilter(key, ALL);
  const clearAllFilters = () => setFilters(INITIAL_FILTERS);

  const filterValueLabel = (key: keyof Filters): string => {
    const value = filters[key];
    return key === 'language' ? languageLabel(value) : value;
  };

  return (
    <Box className="page browse-page">
      <Box className="page-heading-row">
        <Box>
          <Typography component="h1" className="page-title">
            Browse
          </Typography>
          <Typography className="section-subtitle">
            {loading ? 'Loading songs...' : `${filteredTracks.length} of ${tracks.length} songs`}
          </Typography>
        </Box>
      </Box>

      <Box className="browse-filters">
        <Box className="browse-search-field">
          <Search size={18} className="search-icon" />
          <InputBase
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search this library..."
            className="search-input"
            inputProps={{ 'aria-label': 'Search browse library' }}
          />
        </Box>

        <button
          type="button"
          className={`filter-trigger${activeFilters.length > 0 ? ' active' : ''}`}
          onClick={(event) => setFilterAnchor(event.currentTarget)}
        >
          <SlidersHorizontal size={16} />
          <span className="filter-trigger-label">Filters</span>
          {activeFilters.length > 0 && <span className="filter-trigger-count">{activeFilters.length}</span>}
        </button>
      </Box>

      {activeFilters.length > 0 && (
        <Box className="active-filters">
          {activeFilters.map((key) => (
            <button key={key} type="button" className="filter-chip" onClick={() => clearFilter(key)}>
              {FILTER_LABELS[key]}: {filterValueLabel(key)}
              <X size={13} />
            </button>
          ))}
          <button type="button" className="filter-clear-all" onClick={clearAllFilters}>
            Clear all
          </button>
        </Box>
      )}

      <Popover
        open={Boolean(filterAnchor)}
        anchorEl={filterAnchor}
        onClose={() => setFilterAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { className: 'filter-popover' } }}
      >
        <Box className="filter-popover-header">
          <span>Filter songs</span>
          {activeFilters.length > 0 && (
            <button type="button" className="filter-clear-all" onClick={clearAllFilters}>
              Clear all
            </button>
          )}
        </Box>

        <Box className="filter-field">
          <label>Genre</label>
          <Select
            size="small"
            value={filters.genre}
            onChange={(event) => updateFilter('genre', event.target.value)}
            fullWidth
          >
            <MenuItem value={ALL}>All genres</MenuItem>
            {genres.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </Select>
        </Box>

        <Box className="filter-field">
          <label>Artist</label>
          <Select
            size="small"
            value={filters.artist}
            onChange={(event) => updateFilter('artist', event.target.value)}
            fullWidth
          >
            <MenuItem value={ALL}>All artists</MenuItem>
            {artists.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </Select>
        </Box>

        <Box className="filter-field">
          <label>Album</label>
          <Select
            size="small"
            value={filters.album}
            onChange={(event) => updateFilter('album', event.target.value)}
            fullWidth
          >
            <MenuItem value={ALL}>All albums</MenuItem>
            {albums.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </Select>
        </Box>

        <Box className="filter-field">
          <label>Release year</label>
          <Select
            size="small"
            value={filters.year}
            onChange={(event) => updateFilter('year', event.target.value)}
            fullWidth
          >
            <MenuItem value={ALL}>All years</MenuItem>
            {years.map((option) => (
              <MenuItem key={option} value={String(option)}>
                {option}
              </MenuItem>
            ))}
          </Select>
        </Box>

        <Box className="filter-field">
          <label>Language</label>
          <Select
            size="small"
            value={filters.language}
            onChange={(event) => updateFilter('language', event.target.value)}
            fullWidth
          >
            <MenuItem value={ALL}>All languages</MenuItem>
            {languages.map((option) => (
              <MenuItem key={option} value={option}>
                {languageLabel(option)}
              </MenuItem>
            ))}
          </Select>
        </Box>
      </Popover>

      <TrackList
        tracks={filteredTracks}
        activeTrackId={activeTrack?.id}
        onSelectTrack={playTrack}
        loading={loading}
      />
    </Box>
  );
}
