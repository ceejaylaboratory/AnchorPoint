import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  useTransactionStore,
  type ConnectionMode,
  type TransactionStatusUpdatePayload,
  normalizeStatus,
} from '../store/transactionStore';

export type SocketConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';

export interface UseTransactionSocketOptions {
  apiBaseUrl?: string;
  authToken?: string | null;
  enabled?: boolean;
  pollIntervalMs?: number;
  onStatusChange?: (status: SocketConnectionStatus) => void;
  onTransactionUpdate?: (payload: TransactionStatusUpdatePayload) => void;
  onConnectionModeChange?: (mode: ConnectionMode) => void;
}

export interface UseTransactionSocketReturn {
  connectionStatus: SocketConnectionStatus;
  connectionMode: ConnectionMode;
  isPolling: boolean;
  reconnect: () => void;
  pollNow: () => Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 10000;

export const computeSocketUrl = (apiBaseUrl: string): string => {
  try {
    const parsed = new URL(apiBaseUrl);
    return `${parsed.protocol === 'https:' ? 'wss' : 'ws'}://${parsed.host}`;
  } catch {
    return apiBaseUrl;
  }
};

/**
 * Custom hook to subscribe to real-time transaction updates via Socket.io with JWT authentication,
 * automatic Zustand store synchronization, and graceful fallback to polling if WebSocket fails.
 */
export const useTransactionSocket = ({
  apiBaseUrl,
  authToken,
  enabled = true,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  onStatusChange,
  onTransactionUpdate,
  onConnectionModeChange,
}: UseTransactionSocketOptions = {}): UseTransactionSocketReturn => {
  const [connectionStatus, setConnectionStatus] = useState<SocketConnectionStatus>('disconnected');
  const socketRef = useRef<Socket | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | number | null>(null);
  const isPollingRef = useRef(false);

  const baseUrl = apiBaseUrl ?? ((import.meta as any).env?.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3002';
  const socketUrl = useMemo(() => computeSocketUrl(baseUrl), [baseUrl]);

  // Read auth token from prop or localStorage
  const resolvedToken = authToken !== undefined ? authToken : (typeof window !== 'undefined' ? localStorage.getItem('authToken') : null);
  const isAuthenticated = Boolean(resolvedToken);

  const connectionMode = useTransactionStore((state) => state.connectionMode);
  const isPolling = useTransactionStore((state) => state.isPolling);

  const updateMode = useCallback((mode: ConnectionMode) => {
    useTransactionStore.getState().setConnectionMode(mode);
    onConnectionModeChange?.(mode);
  }, [onConnectionModeChange]);

  const updateStatus = useCallback((status: SocketConnectionStatus) => {
    setConnectionStatus(status);
    onStatusChange?.(status);
  }, [onStatusChange]);

  /**
   * Polling fallback function when WebSocket is unavailable or fails.
   */
  const pollTransactions = useCallback(async () => {
    if (!baseUrl || !resolvedToken) return;

    try {
      const res = await fetch(`${baseUrl}/api/transactions`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resolvedToken}`,
        },
      });

      if (!res.ok) {
        return;
      }

      const body = await res.json();
      const rawList = body?.data?.transactions ?? body?.transactions ?? (Array.isArray(body) ? body : []);

      if (Array.isArray(rawList) && rawList.length > 0) {
        const store = useTransactionStore.getState();
        const existingMap = new Map(store.transactions.map((tx) => [tx.id, tx]));

        for (const item of rawList) {
          if (!item.id) continue;
          const existing = existingMap.get(item.id);
          const normalized = normalizeStatus(item.status);

          // If transaction status has changed, trigger store update and animation
          if (existing && existing.status !== normalized) {
            store.applyStatusUpdate({
              id: item.id,
              status: item.status,
              amount: item.amount,
              assetCode: item.assetCode || item.asset,
            });
            onTransactionUpdate?.(item);
          }
        }
      }

      useTransactionStore.getState().setIsPolling(true);
      isPollingRef.current = true;
    } catch (err) {
      console.warn('Transaction polling error:', err);
    }
  }, [baseUrl, resolvedToken, onTransactionUpdate]);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    updateMode('polling');
    useTransactionStore.getState().setIsPolling(true);
    isPollingRef.current = true;

    // Run first poll immediately
    void pollTransactions();

    // Schedule regular polling
    pollTimerRef.current = setInterval(() => {
      void pollTransactions();
    }, pollIntervalMs);
  }, [pollIntervalMs, pollTransactions, updateMode]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current as NodeJS.Timeout);
      pollTimerRef.current = null;
    }
    useTransactionStore.getState().setIsPolling(false);
    isPollingRef.current = false;
  }, []);

  const cleanupSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  const reconnect = useCallback(() => {
    cleanupSocket();
    stopPolling();
    updateStatus('connecting');

    if (!isAuthenticated || !enabled) {
      updateStatus('disconnected');
      updateMode('disconnected');
      return;
    }

    try {
      const socket: Socket = io(socketUrl, {
        auth: { token: resolvedToken },
        transports: ['websocket', 'polling'],
        path: '/socket.io',
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        autoConnect: true,
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        updateStatus('connected');
        updateMode('websocket');
        stopPolling();
      });

      socket.on('disconnect', (reason) => {
        updateStatus('disconnected');
        if (reason !== 'io client disconnect') {
          startPolling();
        }
      });

      socket.on('connect_error', (error) => {
        console.warn('Socket connect error:', error.message);
        updateStatus('disconnected');
        startPolling();
      });

      const handleUpdate = (payload: TransactionStatusUpdatePayload) => {
        if (!payload || !payload.id) return;
        useTransactionStore.getState().applyStatusUpdate(payload);
        onTransactionUpdate?.(payload);
      };

      // Listen for both event formats
      socket.on('transaction:status_update', handleUpdate);
      socket.on('tx_updated', handleUpdate);
    } catch (err) {
      console.error('Failed to initialize Socket.io client:', err);
      updateStatus('disconnected');
      startPolling();
    }
  }, [cleanupSocket, stopPolling, updateStatus, isAuthenticated, enabled, socketUrl, resolvedToken, updateMode, startPolling, onTransactionUpdate]);

  useEffect(() => {
    if (!enabled || !isAuthenticated) {
      cleanupSocket();
      stopPolling();
      updateStatus('disconnected');
      updateMode('disconnected');
      return;
    }

    reconnect();

    return () => {
      cleanupSocket();
      stopPolling();
    };
  }, [enabled, isAuthenticated, socketUrl, resolvedToken, reconnect, cleanupSocket, stopPolling, updateStatus, updateMode]);

  return {
    connectionStatus,
    connectionMode,
    isPolling,
    reconnect,
    pollNow: pollTransactions,
  };
};

export default useTransactionSocket;
