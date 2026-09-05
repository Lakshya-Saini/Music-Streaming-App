import { Box, Typography } from '@mui/material';
import { useMemo } from 'react';
import { CategoryRow } from '../components/CategoryRow';
import { RecentBanner } from '../components/RecentBanner';
import { useLibrary } from '../state/LibraryContext';
import { Track } from '../types';

const MAX_PER_CATEGORY = 20;
/** Caps how many genre rows can appear so the home page never turns into a wall of categories. */
const MAX_GENRE_ROWS = 4;
/** A genre only earns its own row once there's enough of it to justify a shelf. */
const MIN_TRACKS_PER_GENRE = 2;

interface Category {
  key: string;
  title: string;
  tracks: Track[];
}

/** Deterministic per-track number so "Trending" has a stable order without needing real play-count data. */
function hashTrackId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return hash;
}

function buildCategories(tracks: Track[]): Category[] {
  if (tracks.length === 0) {
    return [];
  }

  const categories: Category[] = [];

  const recentlyUploaded = [...tracks].sort(
    (left, right) => new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime(),
  );
  categories.push({
    key: 'recent',
    title: 'Recently Uploaded',
    tracks: recentlyUploaded.slice(0, MAX_PER_CATEGORY),
  });

  /**
   * There's no play-count tracking yet, so "Trending" is a stable shuffle
   * (seeded by track id) rather than real popularity - just enough to keep
   * this row from being a duplicate of "Recently Uploaded".
   */
  const trending = [...tracks].sort((left, right) => hashTrackId(left.id) - hashTrackId(right.id));
  categories.push({ key: 'trending', title: 'Trending Songs', tracks: trending.slice(0, MAX_PER_CATEGORY) });

  const byGenre = new Map<string, Track[]>();
  for (const track of tracks) {
    if (track.genre) {
      byGenre.set(track.genre, [...(byGenre.get(track.genre) ?? []), track]);
    }
  }

  const topGenres = [...byGenre.entries()]
    .filter(([, items]) => items.length >= MIN_TRACKS_PER_GENRE)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
    .slice(0, MAX_GENRE_ROWS);

  for (const [genre, items] of topGenres) {
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
