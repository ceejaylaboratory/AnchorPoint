import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useTransactionStore, type TransactionStatusUpdatePayload } from '../store/transactionStore';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
export type { TransactionStatusUpdatePayload };
export type TransactionUpdatePayload = TransactionStatusUpdatePayload;

type UseSocketOptions = {
  apiBaseUrl: string;
  authToken?: string | null;
  onStatusChange?: (status: ConnectionStatus) => void;
  onTransactionUpdate?: (payload: TransactionUpdatePayload) => void;
  fallbackToPolling?: boolean;
  pollIntervalMs?: number;
};

/**
 * Exponential backoff configuration for WebSocket reconnection
 * Delays: 1s, 2s, 4s, 8s, 16s, 30s (capped)
 */
const MAX_RECONNECT_DELAY = 30000;
const RECONNECT_BASE_DELAY = 1000;

const computeReconnectDelay = (attempt: number): number => {
  const delay = RECONNECT_BASE_DELAY * Math.pow(2, attempt);
  return Math.min(delay, MAX_RECONNECT_DELAY);
};

export const computeSocketUrl = (apiBaseUrl: string) => {
  try {
    const parsed = new URL(apiBaseUrl);
    return `${parsed.protocol === 'https:' ? 'wss' : 'ws'}://${parsed.host}`;
  } catch {
    return apiBaseUrl;
  }
};

export interface UseSocketReturn {
  connectionStatus: ConnectionStatus;
  reconnect: () => void;
  lastSyncTimestamp: number | null;
}

/**
 * Custom hook for WebSocket connection with exponential backoff reconnection,
 * automatic Zustand store synchronization, and state re-synchronization.
 */
export const useSocket = ({
  apiBaseUrl,
  authToken,
  onStatusChange,
  onTransactionUpdate,
  fallbackToPolling = true,
  pollIntervalMs = 10000,
}: UseSocketOptions): UseSocketReturn => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const lastMessageTimestampRef = useRef<number>(Date.now());
  const isManualDisconnectRef = useRef(false);
  const pollTimerRef = useRef<NodeJS.Timeout | number | null>(null);

  const socketUrl = useMemo(() => computeSocketUrl(apiBaseUrl), [apiBaseUrl]);

  const resolvedToken = authToken !== undefined ? authToken : (typeof window !== 'undefined' ? localStorage.getItem('authToken') : null);

  const pollTransactions = useCallback(async () => {
    if (!apiBaseUrl || !resolvedToken) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/transactions`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resolvedToken}`,
        },
      });
      if (!res.ok) return;
      const body = await res.json();
      const rawList = body?.data?.transactions ?? body?.transactions ?? (Array.isArray(body) ? body : []);
      if (Array.isArray(rawList)) {
        for (const item of rawList) {
          if (!item.id) continue;
          useTransactionStore.getState().applyStatusUpdate(item);
          onTransactionUpdate?.(item);
        }
      }
    } catch (err) {
      console.warn('Fallback polling error:', err);
    }
  }, [apiBaseUrl, resolvedToken, onTransactionUpdate]);

  const startPolling = useCallback(() => {
    if (!fallbackToPolling || pollTimerRef.current) return;
    useTransactionStore.getState().setConnectionMode('polling');
    useTransactionStore.getState().setIsPolling(true);
    void pollTransactions();
    pollTimerRef.current = setInterval(() => void pollTransactions(), pollIntervalMs);
  }, [fallbackToPolling, pollIntervalMs, pollTransactions]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current as NodeJS.Timeout);
      pollTimerRef.current = null;
    }
    useTransactionStore.getState().setIsPolling(false);
  }, []);

  /**
   * Fetches missed messages since the last known timestamp
   */
  const fetchMissedMessages = useCallback(async (since: number) => {
    if (!apiBaseUrl) return;

    try {
      const res = await fetch(`${apiBaseUrl}/events/sync?since=${since}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(resolvedToken ? { Authorization: `Bearer ${resolvedToken}` } : {}),
        },
      });

      if (!res.ok) {
        console.warn('Failed to fetch missed messages:', res.status);
        return;
      }

      const body = await res.json();
      const events = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];

      for (const event of events) {
        const payload = event.payload || event;
        if (
          event.type === 'tx_updated' ||
          event.event === 'tx_updated' ||
          event.type === 'transaction:status_update' ||
          event.event === 'transaction:status_update'
        ) {
          useTransactionStore.getState().applyStatusUpdate(payload);
          onTransactionUpdate?.(payload);
        }
      }

      if (events.length > 0) {
        const latestTimestamp = events.reduce((max: number, event: TransactionUpdatePayload) => {
          const ts = Number(event.timestamp) || 0;
          return ts > max ? ts : max;
        }, since);
        setLastSyncTimestamp(latestTimestamp);
        lastMessageTimestampRef.current = latestTimestamp;
      }
    } catch (err) {
      console.warn('Error fetching missed messages:', err);
    }
  }, [apiBaseUrl, resolvedToken, onTransactionUpdate]);

  const handleReconnect = useCallback(() => {
    if (isManualDisconnectRef.current || !socketRef.current) return;

    const attempt = reconnectAttemptRef.current;
    const delay = computeReconnectDelay(attempt);

    setConnectionStatus('reconnecting');
    onStatusChange?.('reconnecting');

    startPolling();

    setTimeout(() => {
      if (socketRef.current && !isManualDisconnectRef.current) {
        socketRef.current.connect();
      }
    }, delay);

    reconnectAttemptRef.current += 1;
  }, [onStatusChange, startPolling]);

  const reconnect = useCallback(() => {
    isManualDisconnectRef.current = false;
    reconnectAttemptRef.current = 0;

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current.connect();
    }
  }, []);

  useEffect(() => {
    if (!apiBaseUrl) {
      setConnectionStatus('disconnected');
      onStatusChange?.('disconnected');
      useTransactionStore.getState().setConnectionMode('disconnected');
      return undefined;
    }

    isManualDisconnectRef.current = false;
    reconnectAttemptRef.current = 0;
    setConnectionStatus('connecting');
    onStatusChange?.('connecting');

    const socket: Socket = io(socketUrl, {
      autoConnect: true,
      transports: ['websocket', 'polling'],
      path: '/socket.io',
      reconnection: false,
      auth: resolvedToken ? { token: resolvedToken } : undefined,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus('connected');
      onStatusChange?.('connected');
      useTransactionStore.getState().setConnectionMode('websocket');
      stopPolling();
      reconnectAttemptRef.current = 0;

      const lastKnownTimestamp = lastMessageTimestampRef.current || Math.floor(Date.now() / 1000) - 60;
      void fetchMissedMessages(lastKnownTimestamp);
    });

    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect' || !isManualDisconnectRef.current) {
        setConnectionStatus('disconnected');
        onStatusChange?.('disconnected');
        handleReconnect();
      } else {
        setConnectionStatus('disconnected');
        onStatusChange?.('disconnected');
      }
    });

    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error.message);
      setConnectionStatus('disconnected');
      onStatusChange?.('disconnected');
      handleReconnect();
    });

    const handlePayload = (payload: TransactionUpdatePayload) => {
      if (payload.timestamp) {
        const ts = Number(payload.timestamp);
        lastMessageTimestampRef.current = ts;
        setLastSyncTimestamp(ts);
      }
      useTransactionStore.getState().applyStatusUpdate(payload);
      onTransactionUpdate?.(payload);
    };

    socket.on('tx_updated', handlePayload);
    socket.on('transaction:status_update', handlePayload);

    return () => {
      isManualDisconnectRef.current = true;
      stopPolling();
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('tx_updated');
      socket.off('transaction:status_update');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [socketUrl, apiBaseUrl, resolvedToken, onStatusChange, onTransactionUpdate, handleReconnect, fetchMissedMessages, stopPolling]);

  return {
    connectionStatus,
    reconnect,
    lastSyncTimestamp,
  };
};

export { useTransactionSocket } from './useTransactionSocket';
export default useSocket;