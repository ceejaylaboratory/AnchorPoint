import React from 'react';
import { WifiOff } from 'lucide-react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

/**
 * Displays a persistent full-width alert at the top of the viewport whenever
 * the browser detects that the network connection has been lost.
 *
 * The banner cannot be dismissed — it disappears automatically once
 * connectivity is restored. Transaction submission buttons should be disabled
 * while `isOnline` is false (see `useNetworkStatus`).
 */
export const OfflineBanner: React.FC = () => {
  const { isOnline } = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-testid="offline-banner"
      className="flex items-center gap-3 border-b border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100"
    >
      <WifiOff size={16} className="shrink-0 text-red-400" aria-hidden="true" />
      <span className="font-medium">
        No internet connection. Transaction submissions are disabled until connectivity is restored.
      </span>
    </div>
  );
};

export default OfflineBanner;
