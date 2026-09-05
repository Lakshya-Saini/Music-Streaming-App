import { Box, Typography } from '@mui/material';
import { useMemo } from 'react';
import { CategoryRow } from '../components/CategoryRow';
import { RecentBanner } from '../components/RecentBanner';
import { useLibrary } from '../state/LibraryContext';
import { Track } from '../types';
import { languageLabel } from '../utils/languages';

const MAX_PER_CATEGORY = 20;

interface Category {
  key: string;
  title: string;
  tracks: Track[];
}

function buildCategories(tracks: Track[]): Category[] {
  if (tracks.length === 0) {
    return [];
  }

  const categories: Category[] = [
    { key: 'trending', title: 'Trending Songs', tracks: tracks.slice(0, MAX_PER_CATEGORY) },
  ];

  const byLanguage = new Map<string, Track[]>();
  const byGenre = new Map<string, Track[]>();

  for (const track of tracks) {
    if (track.language) {
      const label = languageLabel(track.language);
      byLanguage.set(label, [...(byLanguage.get(label) ?? []), track]);
    }
    if (track.genre) {
      byGenre.set(track.genre, [...(byGenre.get(track.genre) ?? []), track]);
    }
  }

  for (const [label, items] of byLanguage) {
    categories.push({ key: `lang-${label}`, title: `${label} Songs`, tracks: items.slice(0, MAX_PER_CATEGORY) });
  }

  for (const [genre, items] of byGenre) {
    categories.push({ key: `genre-${genre}`, title: `${genre} Songs`, tracks: items.slice(0, MAX_PER_CATEGORY) });
  }

  return categories;
}

export function HomePage() {
  const { tracks, loading, errorMessage, activeTrack, playTrack } = useLibrary();
  const categories = useMemo(() => buildCategories(tracks), [tracks]);
  const mostRecent = tracks[0];

  return (
    <Box className="page home-page">
      {loading && tracks.length === 0 && (
        <Typography className="section-subtitle">Loading songs from your catalog...</Typography>
      )}

      {!loading && errorMessage && tracks.length === 0 && (
        <Box className="empty-state">
          <Typography className="empty-title">Could not load songs</Typography>
          <Typography className="section-subtitle">{errorMessage}</Typography>
        </Box>
      )}

      {!loading && !errorMessage && tracks.length === 0 && (
        <Box className="empty-state">
          <Typography className="empty-title">No songs yet</Typography>
          <Typography className="section-subtitle">Upload your first track to build your library.</Typography>
        </Box>
      )}

      {mostRecent && <RecentBanner track={mostRecent} onPlay={playTrack} />}

      <Box className="category-stack">
        {categories.map((category) => (
          <CategoryRow
            key={category.key}
            title={category.title}
            tracks={category.tracks}
            activeTrackId={activeTrack?.id}
            onSelectTrack={playTrack}
          />
        ))}
      </Box>
    </Box>
  );
}
