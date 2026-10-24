import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useTransactionStore, normalizeStatus, type Transaction } from './transactionStore';

describe('transactionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useTransactionStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('normalizeStatus', () => {
    it('normalizes various status casing and formats', () => {
      expect(normalizeStatus('PENDING')).toBe('Pending');
      expect(normalizeStatus('pending')).toBe('Pending');
      expect(normalizeStatus('COMPLETED')).toBe('Completed');
      expect(normalizeStatus('completed')).toBe('Completed');
      expect(normalizeStatus('SUCCESS')).toBe('Completed');
      expect(normalizeStatus('FAILED')).toBe('Failed');
      expect(normalizeStatus('failed')).toBe('Failed');
      expect(normalizeStatus('CANCELLED')).toBe('Failed');
      expect(normalizeStatus('ERROR')).toBe('Failed');
      expect(normalizeStatus('PROCESSING')).toBe('Processing');
      expect(normalizeStatus('processing')).toBe('Processing');
      expect(normalizeStatus(undefined)).toBe('Completed');
    });
  });

  describe('useTransactionStore state and actions', () => {
    const mockTx: Transaction = {
      id: 'TX-100',
      hash: '0x123abc',
      type: 'Deposit',
      asset: 'USDC',
      amount: '500.00',
      counterparty: 'GABC123',
      status: 'Pending',
      date: '2024-03-21',
      timestamp: 1710500000,
      fee: '0.00001 XLM',
    };

    it('initializes with default empty values', () => {
      const state = useTransactionStore.getState();
      expect(state.transactions).toEqual([]);
      expect(state.connectionMode).toBe('disconnected');
      expect(state.isPolling).toBe(false);
      expect(state.recentlyUpdatedIds).toEqual([]);
    });

    it('sets transactions array via setTransactions', () => {
      useTransactionStore.getState().setTransactions([mockTx]);
      expect(useTransactionStore.getState().transactions).toEqual([mockTx]);
    });

    it('updates existing transaction status and triggers animation tracking', () => {
      useTransactionStore.getState().setTransactions([mockTx]);

      useTransactionStore.getState().applyStatusUpdate({
        id: 'TX-100',
        status: 'COMPLETED',
      });

      const updated = useTransactionStore.getState().transactions.find((t) => t.id === 'TX-100');
      expect(updated?.status).toBe('Completed');

      // Row ID is in recentlyUpdatedIds for brief animation
      expect(useTransactionStore.getState().recentlyUpdatedIds).toContain('TX-100');

      // After 2 seconds, animation ID is cleared
      vi.advanceTimersByTime(2000);
      expect(useTransactionStore.getState().recentlyUpdatedIds).not.toContain('TX-100');
    });

    it('prepends a new transaction if ID is not currently in the store', () => {
      useTransactionStore.getState().applyStatusUpdate({
        id: 'TX-NEW-999',
        status: 'PENDING',
        amount: '120.50',
        assetCode: 'XLM',
      });

      const state = useTransactionStore.getState();
      expect(state.transactions).toHaveLength(1);
      expect(state.transactions[0].id).toBe('TX-NEW-999');
      expect(state.transactions[0].status).toBe('Pending');
      expect(state.transactions[0].amount).toBe('120.50');
      expect(state.transactions[0].asset).toBe('XLM');
      expect(state.recentlyUpdatedIds).toContain('TX-NEW-999');
    });

    it('updates connectionMode and isPolling state', () => {
      useTransactionStore.getState().setConnectionMode('websocket');
      expect(useTransactionStore.getState().connectionMode).toBe('websocket');

      useTransactionStore.getState().setConnectionMode('polling');
      useTransactionStore.getState().setIsPolling(true);
      expect(useTransactionStore.getState().connectionMode).toBe('polling');
      expect(useTransactionStore.getState().isPolling).toBe(true);
    });

    it('resets state completely', () => {
      useTransactionStore.getState().setTransactions([mockTx]);
      useTransactionStore.getState().setConnectionMode('websocket');
      useTransactionStore.getState().reset();

      const state = useTransactionStore.getState();
      expect(state.transactions).toEqual([]);
      expect(state.connectionMode).toBe('disconnected');
    });
  });
});
