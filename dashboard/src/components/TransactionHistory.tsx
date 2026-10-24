import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CopyableText } from './CopyableText';
import { 
  ArrowUpRight, 
  ArrowDownLeft, 
  RefreshCw, 
  Search, 
  Zap, 
  Flame, 
  Coins, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useTransactionStore } from '../store/transactionStore';
import { useTransactionSocket } from '../hooks/useTransactionSocket';

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

export const ASSETS = ['USDC', 'XLM', 'EURT', 'ARST', 'yXLM', 'BTC'];
export const TYPES: Transaction['type'][] = ['Deposit', 'Withdrawal', 'Swap', 'Liquidation', 'Mint'];
export const STATUSES: Transaction['status'][] = ['Completed', 'Pending', 'Processing', 'Failed'];

/**
 * Deterministically generates N realistic transaction records for high-volume virtualization testing.
 */
export function generateTransactions(count: number = 10000): Transaction[] {
  const transactions: Transaction[] = [];
  const baseTime = 1710500000000; // March 2024 timestamp

  for (let i = 0; i < count; i++) {
    const type = TYPES[i % TYPES.length];
    const asset = ASSETS[i % ASSETS.length];
    const status = i % 15 === 0 ? 'Pending' : (i % 35 === 0 ? 'Failed' : (i % 20 === 0 ? 'Processing' : 'Completed'));
    const amountNum = ((i * 37) % 5000 + 10.5).toFixed(2);
    const time = baseTime - i * 90000; // 1.5 minutes step back
    const dateObj = new Date(time);
    const dateStr = dateObj.toISOString().split('T')[0];

    // Hex hash
    const hexSuffix = i.toString(16).padStart(8, '0');
    const hash = `0x9f4a...${hexSuffix}`;
    const counterparty = `G${(i * 12345).toString(36).toUpperCase().padStart(4, '0')}...${(i * 54321).toString(36).toUpperCase().padStart(4, '0')}`;

    transactions.push({
      id: `TX-${count - i}`,
      hash,
      type,
      asset,
      amount: amountNum,
      counterparty,
      status,
      date: dateStr,
      timestamp: time,
      fee: '0.00001 XLM'
    });
  }

  return transactions;
}

export const INITIAL_TRANSACTIONS = generateTransactions(100);

/** Matches Tailwind's `md` breakpoint: below it rows render as cards. */
export const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)';

const matchesMobile = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches
    : false;

const useIsMobileViewport = (): boolean => {
  const [isMobile, setIsMobile] = useState(matchesMobile);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  return isMobile;
};

interface TransactionHistoryProps {
  initialData?: Transaction[];
  totalInitialCount?: number;
  rowHeight?: number;
  /** Estimated height of a collapsed mobile card; real heights are measured. */
  mobileRowHeight?: number;
  overscan?: number;
}

export const TransactionHistory: React.FC<TransactionHistoryProps> = ({
  initialData,
  totalInitialCount = 10000,
  rowHeight = 56,
  mobileRowHeight = 112,
  overscan = 15
}) => {
  const storeTransactions = useTransactionStore((state) => state.transactions);
  const setStoreTransactions = useTransactionStore((state) => state.setTransactions);
  const recentlyUpdatedIds = useTransactionStore((state) => state.recentlyUpdatedIds);
  const connectionMode = useTransactionStore((state) => state.connectionMode);

  useTransactionSocket();

  const [dataCount, setDataCount] = useState<number>(totalInitialCount);
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    if (initialData) return initialData;
    if (storeTransactions.length === totalInitialCount && storeTransactions.length > 0) {
      return storeTransactions;
    }
    return generateTransactions(totalInitialCount);
  });

  useEffect(() => {
    if (initialData) {
      setTransactions(initialData);
      setStoreTransactions(initialData);
    } else if (storeTransactions.length === 0 || storeTransactions.length !== totalInitialCount) {
      const initial = generateTransactions(totalInitialCount);
      setTransactions(initial);
      setStoreTransactions(initial);
    }
  }, [initialData, totalInitialCount, setStoreTransactions]);

  useEffect(() => {
    if (storeTransactions.length > 0) {
      setTransactions(storeTransactions);
    }
  }, [storeTransactions]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [expandedTxIds, setExpandedTxIds] = useState<Set<string>>(new Set());

  const parentRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobileViewport();
  // Cards are taller than table rows and grow when expanded, so rows are
  // measured after render instead of being pinned to a fixed height.
  const estimatedRowHeight = isMobile ? mobileRowHeight : rowHeight;

  const toggleExpand = (id: string) => {
    setExpandedTxIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Filtered dataset
  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      if (selectedType !== 'All' && tx.type !== selectedType) return false;
      if (selectedStatus !== 'All' && tx.status !== selectedStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          tx.id.toLowerCase().includes(q) ||
          tx.hash.toLowerCase().includes(q) ||
          tx.counterparty.toLowerCase().includes(q) ||
          tx.asset.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [transactions, selectedType, selectedStatus, searchQuery]);

  // Virtualizer hook
  const rowVirtualizer = useVirtualizer({
    count: filteredTransactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [estimatedRowHeight, rowVirtualizer]);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const itemsToRender = virtualRows.length > 0
    ? virtualRows.map(vr => ({
        index: vr.index,
        key: vr.key,
        start: vr.start,
        size: vr.size,
        tx: filteredTransactions[vr.index]
      }))
    : filteredTransactions.slice(0, overscan).map((tx, idx) => ({
        index: idx,
        key: tx.id,
        start: idx * estimatedRowHeight,
        size: estimatedRowHeight,
        tx
      }));

  const handleToggleVolume = (count: number) => {
    setDataCount(count);
    const newTxs = generateTransactions(count);
    setTransactions(newTxs);
    setStoreTransactions(newTxs);
  };

  return (
    <div className="space-y-6" data-testid="virtualized-tx-history">
      {/* Header and Controls */}
      <div className="glass-card p-6 border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold font-display text-slate-100">
                Transaction History
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-primary/20 text-primary border border-primary/30 flex items-center gap-1">
                <Zap size={12} /> 60 FPS Virtualized
              </span>
              <span
                data-testid="connection-mode-badge"
                className={`px-2 py-0.5 rounded-full text-[11px] font-bold border flex items-center gap-1.5 transition-colors ${
                  connectionMode === 'websocket'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : connectionMode === 'polling'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    connectionMode === 'websocket'
                      ? 'bg-emerald-400 animate-pulse'
                      : connectionMode === 'polling'
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-slate-500'
                  }`}
                />
                {connectionMode === 'websocket' ? 'Live WebSocket' : connectionMode === 'polling' ? 'Live Polling' : 'Offline'}
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Rendering {filteredTransactions.length.toLocaleString()} records smoothly via @tanstack/react-virtual DOM windowing.
            </p>
          </div>

          {/* Quick dataset switcher */}
          <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs flex-wrap">
            <span className="text-slate-400 px-2 font-medium">Dataset:</span>
            <button
              onClick={() => handleToggleVolume(100)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                dataCount === 100 ? 'bg-primary text-white' : 'text-slate-400 hover:text-white'
              }`}
              data-testid="dataset-100-btn"
            >
              100 Rows
            </button>
            <button
              onClick={() => handleToggleVolume(10000)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                dataCount === 10000 ? 'bg-primary text-white' : 'text-slate-400 hover:text-white'
              }`}
              data-testid="dataset-10000-btn"
            >
              10,000+ Rows
            </button>
            <button
              onClick={() => handleToggleVolume(50000)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                dataCount === 50000 ? 'bg-primary text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              50,000 Rows
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="mt-5 pt-5 border-t border-slate-800/80 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-96">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by Tx Hash, ID, or Address..."
              className="input-field w-full pl-9 text-xs"
              data-testid="tx-search-input"
            />
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Type:</span>
              <select
                value={selectedType}
                onChange={e => setSelectedType(e.target.value)}
                className="input-field text-xs py-1.5"
                data-testid="tx-type-filter"
              >
                <option value="All">All Types</option>
                {TYPES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Status:</span>
              <select
                value={selectedStatus}
                onChange={e => setSelectedStatus(e.target.value)}
                className="input-field text-xs py-1.5"
                data-testid="tx-status-filter"
              >
                <option value="All">All Statuses</option>
                {STATUSES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <span className="text-xs text-slate-500 font-mono ml-auto">
              DOM Active: <strong className="text-emerald-400">{itemsToRender.length}</strong> / {filteredTransactions.length}
            </span>
          </div>
        </div>
      </div>

      {/* Virtualized Table Container */}
      <div className="glass-card border border-slate-800 overflow-hidden shadow-2xl">
        {/* Fixed Header: hidden on mobile (<768px), visible on desktop (>=768px) */}
        <div 
          data-testid="tx-table-header"
          className="hidden md:grid grid-cols-12 gap-4 px-6 py-3.5 bg-slate-950/80 border-b border-slate-800 text-xs uppercase tracking-wider font-semibold text-slate-400"
        >
          <div className="col-span-2">Tx ID / Type</div>
          <div className="col-span-3">Hash & Counterparty</div>
          <div className="col-span-2 text-right">Amount</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Date</div>
          <div className="col-span-1 text-right">Fee</div>
        </div>

        {/* Scrollable Virtual Body */}
        <div
          ref={parentRef}
          data-testid="virtual-scroll-container"
          className="overflow-y-auto overflow-x-hidden max-h-[560px] relative scrollbar-thin scrollbar-thumb-slate-700"
          style={{ height: '560px', contain: 'strict' }}
        >
          {filteredTransactions.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm">
              No transactions match your search criteria.
            </div>
          ) : (
            <div
              data-testid="virtual-inner-container"
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative'
              }}
            >
              {itemsToRender.map(item => {
                const tx = item.tx;
                if (!tx) return null;
                const isExpanded = expandedTxIds.has(tx.id);
                const isRecentlyUpdated = recentlyUpdatedIds.includes(tx.id);

                return (
                  <div
                    key={item.key}
                    ref={rowVirtualizer.measureElement}
                    data-index={item.index}
                    data-testid={`tx-row-${item.index}`}
                    data-animating={isRecentlyUpdated ? 'true' : undefined}
                    className={`absolute top-0 left-0 w-full border-b border-slate-800/60 hover:bg-slate-900/60 transition-all duration-700 text-sm ${
                      isRecentlyUpdated
                        ? 'bg-emerald-500/20 ring-1 ring-inset ring-emerald-500/40 animate-pulse'
                        : ''
                    }`}
                    style={{
                      transform: `translateY(${item.start}px)`
                    }}
                  >
                    {/* Desktop View (>= 768px / md): tabular row */}
                    <div 
                      data-testid={`tx-desktop-row-${item.index}`}
                      className="hidden md:grid grid-cols-12 gap-4 items-center px-6 h-14"
                    >
                      {/* Tx ID & Type */}
                      <div className="col-span-2 flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${
                          tx.type === 'Deposit' ? 'bg-emerald-500/10 text-emerald-400' :
                          tx.type === 'Withdrawal' ? 'bg-rose-500/10 text-rose-400' :
                          tx.type === 'Liquidation' ? 'bg-amber-500/10 text-amber-400' :
                          tx.type === 'Swap' ? 'bg-blue-500/10 text-blue-400' :
                          'bg-purple-500/10 text-purple-400'
                        }`}>
                          {tx.type === 'Deposit' && <ArrowDownLeft size={14} />}
                          {tx.type === 'Withdrawal' && <ArrowUpRight size={14} />}
                          {tx.type === 'Liquidation' && <Flame size={14} />}
                          {tx.type === 'Swap' && <RefreshCw size={14} />}
                          {tx.type === 'Mint' && <Coins size={14} />}
                        </div>
                        <div>
                          <span className="font-mono text-xs font-semibold text-slate-200 block">
                            {tx.id}
                          </span>
                          <span className="text-[11px] text-slate-500">{tx.type}</span>
                        </div>
                      </div>

                      {/* Hash & Counterparty */}
                      <div className="col-span-3">
                        <div className="flex items-center gap-1.5 text-xs font-mono text-slate-300">
                          <CopyableText value={tx.hash} label="Transaction ID" />
                          <ExternalLink size={11} className="text-slate-500 hover:text-primary cursor-pointer" />
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 block truncate">
                          {tx.counterparty}
                        </span>
                      </div>

                      {/* Amount */}
                      <div className="col-span-2 text-right">
                        <span className="font-mono font-bold text-slate-100 block">
                          {tx.type === 'Withdrawal' ? `-${tx.amount}` : `+${tx.amount}`} {tx.asset}
                        </span>
                      </div>

                      {/* Status */}
                      <div className="col-span-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          tx.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          tx.status === 'Pending' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                          tx.status === 'Processing' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                          'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                          {tx.status === 'Completed' && <CheckCircle2 size={10} />}
                          {tx.status === 'Pending' && <Clock size={10} />}
                          {tx.status === 'Failed' && <AlertCircle size={10} />}
                          {tx.status}
                        </span>
                      </div>

                      {/* Date */}
                      <div className="col-span-2 text-xs text-slate-400 font-mono">
                        {tx.date}
                      </div>

                      {/* Fee */}
                      <div className="col-span-1 text-right text-[11px] text-slate-500 font-mono">
                        {tx.fee}
                      </div>
                    </div>

                    {/* Mobile Card Layout (< 768px / md:hidden) */}
                    <div 
                      data-testid={`tx-card-${item.index}`}
                      className="md:hidden p-4 space-y-3"
                    >
                      {/* Key Fields: Status, Amount, Asset */}
                      <div className="flex items-center justify-between gap-2">
                        {/* Status badge */}
                        <span 
                          data-testid={`tx-card-status-${item.index}`}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                            tx.status === 'Completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            tx.status === 'Pending' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            tx.status === 'Processing' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                            'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}
                        >
                          {tx.status === 'Completed' && <CheckCircle2 size={12} />}
                          {tx.status === 'Pending' && <Clock size={12} />}
                          {tx.status === 'Failed' && <AlertCircle size={12} />}
                          {tx.status}
                        </span>

                        {/* Amount & Asset */}
                        <div className="text-right" data-testid={`tx-card-amount-${item.index}`}>
                          <span className="font-mono font-bold text-slate-100 text-sm">
                            {tx.type === 'Withdrawal' ? `-${tx.amount}` : `+${tx.amount}`} {tx.asset}
                          </span>
                        </div>
                      </div>

                      {/* Key Fields: Date and Expand Toggle */}
                      <div className="flex items-center justify-between pt-1">
                        {/* Date */}
                        <span 
                          data-testid={`tx-card-date-${item.index}`}
                          className="text-xs text-slate-400 font-mono"
                        >
                          {tx.date}
                        </span>

                        {/* Expand/Collapse Toggle Button for Secondary Fields */}
                        <button
                          type="button"
                          onClick={() => toggleExpand(tx.id)}
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? `Collapse details for ${tx.id}` : `Expand details for ${tx.id}`}
                          data-testid={`tx-card-expand-btn-${item.index}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
                        >
                          <span>{isExpanded ? 'Hide Details' : 'Details'}</span>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>

                      {/* Collapsible Secondary Fields */}
                      {isExpanded && (
                        <div 
                          data-testid={`tx-card-secondary-${item.index}`}
                          className="pt-3 mt-1 border-t border-slate-800/80 space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400 font-medium">Tx ID:</span>
                            <span className="font-mono font-semibold text-slate-200">{tx.id}</span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-slate-400 font-medium">Type:</span>
                            <div className="flex items-center gap-1.5">
                              <div className={`p-1 rounded ${
                                tx.type === 'Deposit' ? 'bg-emerald-500/10 text-emerald-400' :
                                tx.type === 'Withdrawal' ? 'bg-rose-500/10 text-rose-400' :
                                tx.type === 'Liquidation' ? 'bg-amber-500/10 text-amber-400' :
                                tx.type === 'Swap' ? 'bg-blue-500/10 text-blue-400' :
                                'bg-purple-500/10 text-purple-400'
                              }`}>
                                {tx.type === 'Deposit' && <ArrowDownLeft size={12} />}
                                {tx.type === 'Withdrawal' && <ArrowUpRight size={12} />}
                                {tx.type === 'Liquidation' && <Flame size={12} />}
                                {tx.type === 'Swap' && <RefreshCw size={12} />}
                                {tx.type === 'Mint' && <Coins size={12} />}
                              </div>
                              <span className="text-slate-300 font-medium">{tx.type}</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-400 font-medium">Hash:</span>
                            <div className="flex items-center gap-1.5 font-mono text-slate-300">
                              <CopyableText value={tx.hash} label="Transaction ID" />
                              <ExternalLink size={12} className="text-slate-500 hover:text-primary cursor-pointer shrink-0" />
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-400 font-medium">Counterparty:</span>
                            <span className="font-mono text-slate-400 truncate max-w-[160px] sm:max-w-[220px]">
                              {tx.counterparty}
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-slate-400 font-medium">Fee:</span>
                            <span className="font-mono text-slate-400">{tx.fee}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TransactionHistory;
