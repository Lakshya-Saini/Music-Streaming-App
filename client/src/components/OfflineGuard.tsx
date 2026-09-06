import { Backdrop, Typography } from '@mui/material';
import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Blocks the entire app behind a full-screen, non-dismissible overlay
 * whenever the browser reports no network connection. `navigator.onLine` is
 * read synchronously on mount (not just via the `offline` event) so a page
 * refresh while offline shows the guard immediately instead of only after
 * the next state change; it clears itself as soon as the `online` event
 * fires.
 */
export function OfflineGuard() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) {
    return null;
  }

  return (
    <Backdrop
      open
      className="offline-guard"
      sx={{
        zIndex: (theme) => theme.zIndex.modal + 10,
        flexDirection: 'column',
        gap: 1.5,
        color: '#fff',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
      }}
    >
      <WifiOff size={40} />
      <Typography variant="h6">You're offline</Typography>
      <Typography variant="body2" sx={{ opacity: 0.75, maxWidth: 320, textAlign: 'center' }}>
        Check your internet connection. The app will unlock automatically once you're back online.
      </Typography>
    </Backdrop>
  );
}
