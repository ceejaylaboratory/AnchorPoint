import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DEFAULT_NETWORK,
  getEndpoints,
  toNetworkType,
} from '../lib/stellar/networks';
import type { NetworkEndpoints, NetworkType } from '../lib/stellar/networks';
import { createStellarServers } from '../lib/stellar/servers';
import type { StellarServerFactory, StellarServers } from '../lib/stellar/servers';

export type NetworkSwitchStatus = 'idle' | 'loading' | 'error';

export interface NetworkContextValue {
  network: NetworkType;
  /** Horizon / Soroban URLs and passphrase for the active network. */
  endpoints: NetworkEndpoints;
  /** SDK server pair, rebuilt whenever the network changes. */
  servers: StellarServers;
  status: NetworkSwitchStatus;
  error: string | null;
  /** Persists the switch to the backend, then repoints the SDK servers. */
  switchNetwork: (next: NetworkType) => Promise<void>;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

export interface NetworkProviderProps {
  children: React.ReactNode;
  apiBaseUrl: string;
  /** Skips the initial backend lookup. Useful in tests and Storybook. */
  initialNetwork?: NetworkType;
  /** Injection seam so tests can observe server re-initialisation. */
  createServers?: StellarServerFactory;
}

export const NetworkProvider: React.FC<NetworkProviderProps> = ({
  children,
  apiBaseUrl,
  initialNetwork,
  createServers = createStellarServers,
}) => {
  const [network, setNetwork] = useState<NetworkType>(initialNetwork ?? DEFAULT_NETWORK);
  const [status, setStatus] = useState<NetworkSwitchStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // The factory is only ever read inside effects/memos, so a ref keeps a new
  // inline function from rebuilding the servers on every render.
  const factoryRef = useRef(createServers);
  factoryRef.current = createServers;

  // Adopt whatever network the backend reports as active.
  useEffect(() => {
    if (initialNetwork) return;

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/admin/network`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && data?.network) {
          setNetwork(toNetworkType(data.network));
        }
      } catch (err) {
        console.error('Failed to fetch network config:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, initialNetwork]);

  const endpoints = useMemo(() => getEndpoints(network), [network]);

  // Rebuilding here — rather than inside switchNetwork — keeps the servers
  // correct however the network changed, including the initial backend lookup.
  const servers = useMemo(() => factoryRef.current(endpoints), [endpoints]);

  const switchNetwork = useCallback(
    async (next: NetworkType) => {
      if (next === network) return;

      setStatus('loading');
      setError(null);

      try {
        const response = await fetch(`${apiBaseUrl}/api/admin/network`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ network: next }),
        });

        if (!response.ok) {
          throw new Error('Failed to switch network');
        }

        setNetwork(next);
        setStatus('idle');
      } catch (err) {
        // Leave `network` untouched: the SDK servers must keep pointing at the
        // network the backend is still on.
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Failed to switch network');
      }
    },
    [apiBaseUrl, network],
  );

  const value = useMemo<NetworkContextValue>(
    () => ({ network, endpoints, servers, status, error, switchNetwork }),
    [network, endpoints, servers, status, error, switchNetwork],
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
};

export function useNetwork(): NetworkContextValue {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}

/** Like useNetwork, but returns null outside a provider (for reusable widgets). */
export function useOptionalNetwork(): NetworkContextValue | null {
  return useContext(NetworkContext);
}

export default NetworkProvider;
