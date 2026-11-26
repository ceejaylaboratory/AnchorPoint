import { useCallback, useEffect, useRef, useState } from 'react';

export interface NetworkStatus {
  isOnline: boolean;
}

/**
 * Tracks browser online/offline status by listening to the `window` online
 * and offline events. The returned `isOnline` value is kept in sync for the
 * lifetime of the component that calls this hook.
 *
 * Usage:
 * ```ts
 * const { isOnline } = useNetworkStatus();
 * ```
 */
export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const mounted = useRef(true);

  const handleOnline = useCallback(() => {
    if (mounted.current) setIsOnline(true);
  }, []);

  const handleOffline = useCallback(() => {
    if (mounted.current) setIsOnline(false);
  }, []);

  useEffect(() => {
    mounted.current = true;

    // Re-sync at mount in case the browser went offline before the component
    // tree was first rendered.
    setIsOnline(navigator.onLine);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      mounted.current = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  return { isOnline };
}
