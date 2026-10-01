import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
export type TransactionUpdatePayload = {
  id: string;
  status?: string;
  ledger?: number;
  timestamp?: number;
  [key: string]: unknown;
};

type UseSocketOptions = {
  apiBaseUrl: string;
  onStatusChange?: (status: ConnectionStatus) => void;
  onTransactionUpdate?: (payload: TransactionUpdatePayload) => void;
};

/**
 * Exponential backoff configuration for WebSocket reconnection
 * Delays: 1s, 2s, 4s, 8s, 16s, 30s (capped)
 */
const MAX_RECONNECT_DELAY = 30000;
const RECONNECT_BASE_DELAY = 1000;

/**
 * Computes the next reconnect delay using exponential backoff
 * @param attempt - Current reconnection attempt number (0-indexed)
 * @returns Delay in milliseconds
 */
const computeReconnectDelay = (attempt: number): number => {
  const delay = RECONNECT_BASE_DELAY * Math.pow(2, attempt);
  return Math.min(delay, MAX_RECONNECT_DELAY);
};

const computeSocketUrl = (apiBaseUrl: string) => {
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
 * Custom hook for WebSocket connection with exponential backoff reconnection
 * and automatic state re-synchronization on reconnection.
 */
export const useSocket = ({ apiBaseUrl, onStatusChange, onTransactionUpdate }: UseSocketOptions): UseSocketReturn => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number | null>(null);
  
  const socketRef = useRef<Socket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const lastMessageTimestampRef = useRef<number>(Date.now());
  const isManualDisconnectRef = useRef(false);

  const socketUrl = useMemo(() => computeSocketUrl(apiBaseUrl), [apiBaseUrl]);

  /**
   * Fetches missed messages since the last known timestamp
   * This enables state re-synchronization after a reconnection
   */
  const fetchMissedMessages = useCallback(async (since: number) => {
    if (!apiBaseUrl) return;
    
    try {
      const res = await fetch(`${apiBaseUrl}/events/sync?since=${since}`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!res.ok) {
        console.warn('Failed to fetch missed messages:', res.status);
        return;
      }
      
      const body = await res.json();
      const events = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
      
      // Process each missed message
      for (const event of events) {
        if (event.type === 'tx_updated' || event.event === 'tx_updated') {
          onTransactionUpdate?.(event.payload || event);
        }
      }
      
      // Update sync timestamp
      if (events.length > 0) {
        const latestTimestamp = events.reduce((max: number, event: TransactionUpdatePayload) => {
          const ts = event.timestamp || 0;
          return ts > max ? ts : max;
        }, since);
        setLastSyncTimestamp(latestTimestamp);
        lastMessageTimestampRef.current = latestTimestamp;
      }
    } catch (err) {
      console.warn('Error fetching missed messages:', err);
    }
  }, [apiBaseUrl, onTransactionUpdate]);

  /**
   * Attempts to reconnect with exponential backoff
   */
  const handleReconnect = useCallback(() => {
    if (isManualDisconnectRef.current || !socketRef.current) return;
    
    const attempt = reconnectAttemptRef.current;
    const delay = computeReconnectDelay(attempt);
    
    setConnectionStatus('reconnecting');
    onStatusChange?.('reconnecting');
    
    console.log(`WebSocket reconnecting in ${delay}ms (attempt ${attempt + 1})`);
    
    // Schedule reconnection attempt
    setTimeout(() => {
      if (socketRef.current && !isManualDisconnectRef.current) {
        socketRef.current.connect();
      }
    }, delay);
    
    reconnectAttemptRef.current += 1;
  }, [onStatusChange]);

  /**
   * Manual reconnect function (can be called by UI)
   */
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
      return undefined;
    }

    // Reset state for new connection
    isManualDisconnectRef.current = false;
    reconnectAttemptRef.current = 0;
    setConnectionStatus('connecting');
    onStatusChange?.('connecting');

    const socket: Socket = io(socketUrl, {
      autoConnect: true,
      transports: ['websocket'],
      path: '/socket.io',
      // Disable default reconnection - we handle it manually for exponential backoff
      reconnection: false,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus('connected');
      onStatusChange?.('connected');
      reconnectAttemptRef.current = 0;
      
      // Fetch missed messages if we have a last known timestamp
      const lastKnownTimestamp = lastMessageTimestampRef.current || Math.floor(Date.now() / 1000) - 60;
      void fetchMissedMessages(lastKnownTimestamp);
    });

    socket.on('disconnect', (reason) => {
      // Only trigger reconnect if not manually disconnected
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
      
      // Trigger exponential backoff reconnect
      handleReconnect();
    });

    socket.on('tx_updated', (payload: TransactionUpdatePayload) => {
      // Update the last message timestamp for sync purposes
      if (payload.timestamp) {
        lastMessageTimestampRef.current = payload.timestamp;
        setLastSyncTimestamp(payload.timestamp);
      }
      onTransactionUpdate?.(payload);
    });

    return () => {
      isManualDisconnectRef.current = true;
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('tx_updated');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [socketUrl, apiBaseUrl, onStatusChange, onTransactionUpdate, handleReconnect, fetchMissedMessages]);

  return {
    connectionStatus,
    reconnect,
    lastSyncTimestamp,
  };
};