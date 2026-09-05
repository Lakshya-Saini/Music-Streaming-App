import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { listReadyTracks } from '../api/tracks';
import { Track } from '../types';

interface LibraryContextValue {
  tracks: Track[];
  loading: boolean;
  errorMessage: string | null;
  reload: () => Promise<void>;
  activeTrack: Track | null;
  playTrack: (track: Track) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchResults: Track[];
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTrack, setActiveTrack] = useState<Track | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const readyTracks = await listReadyTracks();
      setTracks(readyTracks);
      setActiveTrack((current) => {
        if (current && readyTracks.some((track) => track.id === current.id)) {
          return current;
        }
        return readyTracks[0] ?? null;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not load songs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return [];
    }
    return tracks.filter(
      (track) =>
        track.title.toLowerCase().includes(query) ||
        track.artist.toLowerCase().includes(query) ||
        track.album.toLowerCase().includes(query),
    );
  }, [searchQuery, tracks]);

  const value = useMemo<LibraryContextValue>(
    () => ({
      tracks,
      loading,
      errorMessage,
      reload,
      activeTrack,
      playTrack: setActiveTrack,
      searchQuery,
      setSearchQuery,
      searchResults,
    }),
    [tracks, loading, errorMessage, reload, activeTrack, searchQuery, searchResults],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used within a LibraryProvider');
  }
  return context;
}
