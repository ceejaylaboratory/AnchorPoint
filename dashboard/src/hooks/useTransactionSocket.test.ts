import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransactionSocket } from './useTransactionSocket';
import { useTransactionStore } from '../store/transactionStore';
import * as socketIoClient from 'socket.io-client';

vi.mock('socket.io-client', () => {
  return {
    io: vi.fn(),
  };
});

describe('useTransactionSocket', () => {
  let mockSocket: any;
  let socketEventHandlers: Record<string, (...args: any[]) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    useTransactionStore.getState().reset();
    localStorage.clear();
    socketEventHandlers = {};

    mockSocket = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        socketEventHandlers[event] = handler;
        return mockSocket;
      }),
      off: vi.fn((event: string) => {
        delete socketEventHandlers[event];
        return mockSocket;
      }),
      removeAllListeners: vi.fn(() => {
        socketEventHandlers = {};
        return mockSocket;
      }),
      disconnect: vi.fn(),
      connect: vi.fn(),
    };

    vi.mocked(socketIoClient.io).mockReturnValue(mockSocket as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does NOT connect to Socket.io when user is not authenticated', () => {
    renderHook(() =>
      useTransactionSocket({
        apiBaseUrl: 'http://localhost:3002',
        authToken: null,
      })
    );

    expect(socketIoClient.io).not.toHaveBeenCalled();
    expect(useTransactionStore.getState().connectionMode).toBe('disconnected');
  });

  it('connects to Socket.io with auth token when authenticated', () => {
    renderHook(() =>
      useTransactionSocket({
        apiBaseUrl: 'http://localhost:3002',
        authToken: 'test-jwt-token-123',
      })
    );

    expect(socketIoClient.io).toHaveBeenCalledWith(
      'ws://localhost:3002',
      expect.objectContaining({
        auth: { token: 'test-jwt-token-123' },
        transports: ['websocket', 'polling'],
        path: '/socket.io',
      })
    );
  });

  it('reads auth token from localStorage if not explicitly passed', () => {
    localStorage.setItem('authToken', 'local-storage-jwt');

    renderHook(() =>
      useTransactionSocket({
        apiBaseUrl: 'http://localhost:3002',
      })
    );

    expect(socketIoClient.io).toHaveBeenCalledWith(
      'ws://localhost:3002',
      expect.objectContaining({
        auth: { token: 'local-storage-jwt' },
      })
    );
  });

  it('updates Zustand store when receiving transaction:status_update event', () => {
    // Seed initial transaction
    useTransactionStore.getState().setTransactions([
      {
        id: 'TX-456',
        hash: '0xabc',
        type: 'Deposit',
        asset: 'USDC',
        amount: '100.00',
        counterparty: 'GABC',
        status: 'Pending',
        date: '2024-03-21',
        timestamp: 1710500000,
        fee: '0.00001 XLM',
      },
    ]);

    renderHook(() =>
      useTransactionSocket({
        apiBaseUrl: 'http://localhost:3002',
        authToken: 'valid-token',
      })
    );

    expect(socketEventHandlers['transaction:status_update']).toBeDefined();

    // Trigger transaction:status_update
    act(() => {
      socketEventHandlers['transaction:status_update']({
        id: 'TX-456',
        status: 'COMPLETED',
      });
    });

    const tx = useTransactionStore.getState().transactions.find((t) => t.id === 'TX-456');
    expect(tx?.status).toBe('Completed');
    expect(useTransactionStore.getState().recentlyUpdatedIds).toContain('TX-456');
  });

  it('updates Zustand store when receiving tx_updated event', () => {
    useTransactionStore.getState().setTransactions([
      {
        id: 'TX-789',
        hash: '0xdef',
        type: 'Withdrawal',
        asset: 'XLM',
        amount: '50.00',
        counterparty: 'GDEF',
        status: 'Pending',
        date: '2024-03-21',
        timestamp: 1710500000,
        fee: '0.00001 XLM',
      },
    ]);

    renderHook(() =>
      useTransactionSocket({
        apiBaseUrl: 'http://localhost:3002',
        authToken: 'valid-token',
      })
    );

    expect(socketEventHandlers['tx_updated']).toBeDefined();

    act(() => {
      socketEventHandlers['tx_updated']({
        id: 'TX-789',
        status: 'FAILED',
      });
    });

    const tx = useTransactionStore.getState().transactions.find((t) => t.id === 'TX-789');
    expect(tx?.status).toBe('Failed');
  });

  it('falls back to polling if WebSocket encounters connect_error', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        data: {
          transactions: [
            { id: 'TX-POLL-1', status: 'COMPLETED', amount: '200', assetCode: 'USDC' },
          ],
        },
      }),
    } as any);

    renderHook(() =>
      useTransactionSocket({
        apiBaseUrl: 'http://localhost:3002',
        authToken: 'valid-token',
        pollIntervalMs: 5000,
      })
    );

    // Simulate WebSocket connection failure
    act(() => {
      socketEventHandlers['connect_error']?.(new Error('Connection failed'));
    });

    expect(useTransactionStore.getState().connectionMode).toBe('polling');

    // Fast-forward polling interval
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3002/api/transactions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer valid-token',
        }),
      })
    );
  });

  it('stops polling and switches to websocket mode when socket connects', () => {
    renderHook(() =>
      useTransactionSocket({
        apiBaseUrl: 'http://localhost:3002',
        authToken: 'valid-token',
      })
    );

    // Simulate connect event
    act(() => {
      socketEventHandlers['connect']?.();
    });

    expect(useTransactionStore.getState().connectionMode).toBe('websocket');
    expect(useTransactionStore.getState().isPolling).toBe(false);
  });

  it('cleans up socket listeners and disconnects on unmount', () => {
    const { unmount } = renderHook(() =>
      useTransactionSocket({
        apiBaseUrl: 'http://localhost:3002',
        authToken: 'valid-token',
      })
    );

    unmount();

    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(mockSocket.removeAllListeners).toHaveBeenCalled();
  });
});
