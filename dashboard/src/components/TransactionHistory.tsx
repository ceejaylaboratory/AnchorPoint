import React, { useState, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { 
  ArrowUpRight, 
  ArrowDownLeft, 
  RefreshCw, 
  Search, 
  Zap, 
  SlidersHorizontal,
  Flame, 
  Coins, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  ExternalLink
} from 'lucide-react';

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

interface TransactionHistoryProps {
  initialData?: Transaction[];
  totalInitialCount?: number;
  rowHeight?: number;
  overscan?: number;
}

export const TransactionHistory: React.FC<TransactionHistoryProps> = ({
  initialData,
  totalInitialCount = 10000,
  rowHeight = 56,
  overscan = 15
}) => {
  const [dataCount, setDataCount] = useState<number>(totalInitialCount);
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    return initialData ?? generateTransactions(totalInitialCount);
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');

  const parentRef = useRef<HTMLDivElement>(null);

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
    estimateSize: () => rowHeight,
    overscan
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  const handleToggleVolume = (count: number) => {
    setDataCount(count);
    setTransactions(generateTransactions(count));
  };

  return (
    <div className="space-y-6" data-testid="virtualized-tx-history">
      {/* Header and Controls */}
      <div className="glass-card p-6 border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold font-display text-slate-100">
                Transaction History
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-primary/20 text-primary border border-primary/30 flex items-center gap-1">
                <Zap size={12} /> 60 FPS Virtualized
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Rendering {filteredTransactions.length.toLocaleString()} records smoothly via @tanstack/react-virtual DOM windowing.
            </p>
          </div>

          {/* Quick dataset switcher */}
          <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs">
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
              DOM Active: <strong className="text-emerald-400">{virtualRows.length}</strong> / {filteredTransactions.length}
            </span>
          </div>
        </div>
      </div>

      {/* Virtualized Table Container */}
      <div className="glass-card border border-slate-800 overflow-hidden shadow-2xl">
        {/* Fixed Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-3.5 bg-slate-950/80 border-b border-slate-800 text-xs uppercase tracking-wider font-semibold text-slate-400">
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
          className="overflow-y-auto max-h-[560px] relative scrollbar-thin scrollbar-thumb-slate-700"
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
              {virtualRows.map(virtualRow => {
                const tx = filteredTransactions[virtualRow.index];
                if (!tx) return null;

                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    data-testid={`tx-row-${virtualRow.index}`}
                    className="absolute top-0 left-0 w-full grid grid-cols-12 gap-4 items-center px-6 border-b border-slate-800/60 hover:bg-slate-900/60 transition-colors text-sm"
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`
                    }}
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
                        <span className="truncate max-w-[140px]">{tx.hash}</span>
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
