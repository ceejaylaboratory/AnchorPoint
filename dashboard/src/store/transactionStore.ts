import { create } from 'zustand';

export interface Transaction {
  id: string;
  hash: string;
  type: 'Deposit' | 'Withdrawal' | 'Swap' | 'Liquidation' | 'Mint';
  asset: string;
  amount: string;
  counterparty: string;
  status: 'Completed' | 'Pending' | 'Processing' | 'Failed';
  date: string;
  timestamp: number;
  fee: string;
}

export type ConnectionMode = 'websocket' | 'polling' | 'disconnected';

export interface TransactionStatusUpdatePayload {
  id: string;
  status: string;
  amount?: string | number;
  assetCode?: string;
  asset?: string;
  type?: Transaction['type'] | string;
  hash?: string;
  counterparty?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface TransactionState {
  transactions: Transaction[];
  connectionMode: ConnectionMode;
  isPolling: boolean;
  recentlyUpdatedIds: string[];
  lastUpdated: number | null;
  error: string | null;

  setTransactions: (transactions: Transaction[]) => void;
  applyStatusUpdate: (payload: TransactionStatusUpdatePayload) => void;
  setConnectionMode: (mode: ConnectionMode) => void;
  setIsPolling: (isPolling: boolean) => void;
  setError: (error: string | null) => void;
  clearRecentlyUpdated: (id: string) => void;
  reset: () => void;
}

/**
 * Normalizes backend transaction status strings into the frontend Transaction['status'] enum.
 */
export function normalizeStatus(rawStatus?: string): Transaction['status'] {
  if (!rawStatus) return 'Completed';
  const s = rawStatus.toUpperCase();
  if (s === 'PENDING') return 'Pending';
  if (s === 'PROCESSING') return 'Processing';
  if (s === 'FAILED' || s === 'CANCELLED' || s === 'ERROR') return 'Failed';
  if (s === 'COMPLETED' || s === 'SUCCESS') return 'Completed';

  // Capitalize first letter
  const formatted = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase();
  if (formatted === 'Pending' || formatted === 'Processing' || formatted === 'Failed' || formatted === 'Completed') {
    return formatted as Transaction['status'];
  }
  return 'Completed';
}

export const useTransactionStore = create<TransactionState>()((set, get) => ({
  transactions: [],
  connectionMode: 'disconnected',
  isPolling: false,
  recentlyUpdatedIds: [],
  lastUpdated: null,
  error: null,

  setTransactions: (transactions) => set({ transactions }),

  applyStatusUpdate: (payload) => {
    if (!payload || !payload.id) return;
    const normalized = normalizeStatus(payload.status);

    set((state) => {
      const existingIndex = state.transactions.findIndex((tx) => tx.id === payload.id);
      let nextTransactions: Transaction[];

      if (existingIndex !== -1) {
        const existing = state.transactions[existingIndex];
        const updated: Transaction = {
          ...existing,
          status: normalized,
          amount: payload.amount !== undefined ? String(payload.amount) : existing.amount,
          asset: (payload.assetCode || payload.asset || existing.asset) as string,
          timestamp: payload.timestamp ?? Date.now(),
        };
        nextTransactions = [
          ...state.transactions.slice(0, existingIndex),
          updated,
          ...state.transactions.slice(existingIndex + 1),
        ];
      } else {
        const newTx: Transaction = {
          id: payload.id,
          hash: (payload.hash as string) || `0x${Math.random().toString(16).slice(2, 10)}...`,
          type: (payload.type as Transaction['type']) || 'Deposit',
          asset: (payload.assetCode || payload.asset || 'USDC') as string,
          amount: payload.amount !== undefined ? String(payload.amount) : '0.00',
          counterparty: (payload.counterparty as string) || 'GDEFAULT...',
          status: normalized,
          date: new Date().toISOString().split('T')[0],
          timestamp: payload.timestamp ?? Date.now(),
          fee: '0.00001 XLM',
        };
        nextTransactions = [newTx, ...state.transactions];
      }

      const nextRecentlyUpdated = state.recentlyUpdatedIds.includes(payload.id)
        ? state.recentlyUpdatedIds
        : [...state.recentlyUpdatedIds, payload.id];

      return {
        transactions: nextTransactions,
        recentlyUpdatedIds: nextRecentlyUpdated,
        lastUpdated: Date.now(),
      };
    });

    // Automatically remove row animation after 2 seconds
    setTimeout(() => {
      get().clearRecentlyUpdated(payload.id);
    }, 2000);
  },

  setConnectionMode: (connectionMode) => set({ connectionMode }),
  setIsPolling: (isPolling) => set({ isPolling }),
  setError: (error) => set({ error }),

  clearRecentlyUpdated: (id) =>
    set((state) => ({
      recentlyUpdatedIds: state.recentlyUpdatedIds.filter((txId) => txId !== id),
    })),

  reset: () =>
    set({
      transactions: [],
      connectionMode: 'disconnected',
      isPolling: false,
      recentlyUpdatedIds: [],
      lastUpdated: null,
      error: null,
    }),
}));
