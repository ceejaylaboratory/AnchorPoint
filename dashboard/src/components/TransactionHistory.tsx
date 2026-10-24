import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  ChevronUp,
  SlidersHorizontal,
  X
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
  const [expandedTxIds, setExpandedTxIds] = useState<Set<string>>(new Set());
  // Advanced filters
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [statusMulti, setStatusMulti] = useState<string[]>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('status');
      return p ? p.split(',').filter(Boolean) : [];
    } catch { return []; }
  });
  const [assetFilter, setAssetFilter] = useState<string>(() => {
    try { return new URLSearchParams(window.location.search).get('asset') ?? 'All'; }
    catch { return 'All'; }
  });
  const [dateFrom, setDateFrom] = useState<string>(() => {
    try { return new URLSearchParams(window.location.search).get('from') ?? ''; }
    catch { return ''; }
  });
  const [dateTo, setDateTo] = useState<string>(() => {
    try { return new URLSearchParams(window.location.search).get('to') ?? ''; }
    catch { return ''; }
  });
  const [minAmount, setMinAmount] = useState<string>(() => {
    try { return new URLSearchParams(window.location.search).get('min') ?? ''; }
    catch { return ''; }
  });
  const [maxAmount, setMaxAmount] = useState<string>(() => {
    try { return new URLSearchParams(window.location.search).get('max') ?? ''; }
    catch { return ''; }
  });

  // Sync filter state to URL query params
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const setOrDel = (k: string, v: string) => { if (v) params.set(k, v); else params.delete(k); };
      setOrDel('q', searchQuery.trim());
      if (statusMulti.length > 0) params.set('status', statusMulti.join(','));
      else if (selectedStatus !== 'All') params.set('status', selectedStatus);
      else params.delete('status');
      setOrDel('asset', assetFilter !== 'All' ? assetFilter : '');
      setOrDel('type', selectedType !== 'All' ? selectedType : '');
      setOrDel('from', dateFrom);
      setOrDel('to', dateTo);
      setOrDel('min', minAmount);
      setOrDel('max', maxAmount);
      const qs = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    } catch { /* non-browser */ }
  }, [searchQuery, selectedType, selectedStatus, statusMulti, assetFilter, dateFrom, dateTo, minAmount, maxAmount]);

  const toggleStatusMulti = (s: string) => {
    setStatusMulti(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedType('All');
    setSelectedStatus('All');
    setStatusMulti([]);
    setAssetFilter('All');
    setDateFrom('');
    setDateTo('');
    setMinAmount('');
    setMaxAmount('');
  };

  const activeChips: { key: string; label: string; clear: () => void }[] = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (selectedType !== 'All') chips.push({ key: 'type', label: `Type: ${selectedType}`, clear: () => setSelectedType('All') });
    const effStatuses = statusMulti.length > 0 ? statusMulti : (selectedStatus !== 'All' ? [selectedStatus] : []);
    effStatuses.forEach(s => chips.push({ key: `status-${s}`, label: `Status: ${s}`, clear: () => { setSelectedStatus('All'); setStatusMulti(prev => prev.filter(x => x !== s)); } }));
    if (assetFilter !== 'All') chips.push({ key: 'asset', label: `Asset: ${assetFilter}`, clear: () => setAssetFilter('All') });
    if (dateFrom) chips.push({ key: 'from', label: `From: ${dateFrom}`, clear: () => setDateFrom('') });
    if (dateTo) chips.push({ key: 'to', label: `To: ${dateTo}`, clear: () => setDateTo('') });
    if (minAmount) chips.push({ key: 'min', label: `Min: ${minAmount}`, clear: () => setMinAmount('') });
    if (maxAmount) chips.push({ key: 'max', label: `Max: ${maxAmount}`, clear: () => setMaxAmount('') });
    if (searchQuery.trim()) chips.push({ key: 'q', label: `"${searchQuery.trim()}"`, clear: () => setSearchQuery('') });
    return chips;
  }, [selectedType, selectedStatus, statusMulti, assetFilter, dateFrom, dateTo, minAmount, maxAmount, searchQuery]);

  const parentRef = useRef<HTMLDivElement>(null);

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
    const min = minAmount !== '' ? parseFloat(minAmount) : NaN;
    const max = maxAmount !== '' ? parseFloat(maxAmount) : NaN;
    return transactions.filter(tx => {
      if (selectedType !== 'All' && tx.type !== selectedType) return false;
      const effStatuses = statusMulti.length > 0 ? statusMulti : (selectedStatus !== 'All' ? [selectedStatus] : []);
      if (effStatuses.length > 0 && !effStatuses.includes(tx.status)) return false;
      if (assetFilter !== 'All' && tx.asset !== assetFilter) return false;
      if (dateFrom && tx.date < dateFrom) return false;
      if (dateTo && tx.date > dateTo) return false;
      const amt = parseFloat(tx.amount);
      if (!Number.isNaN(min) && amt < min) return false;
      if (!Number.isNaN(max) && amt > max) return false;
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
  }, [transactions, selectedType, selectedStatus, statusMulti, assetFilter, dateFrom, dateTo, minAmount, maxAmount, searchQuery]);

  // Virtualizer hook
  const rowVirtualizer = useVirtualizer({
    count: filteredTransactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan
  });

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
        start: idx * rowHeight,
        size: rowHeight,
        tx
      }));

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
            <button
              type="button"
              onClick={() => setFilterDrawerOpen(v => !v)}
              aria-expanded={filterDrawerOpen}
              data-testid="tx-filter-drawer-toggle"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
            >
              <SlidersHorizontal size={14} /> Filters{activeChips.length > 0 ? ` (${activeChips.length})` : ''}
            </button>
          </div>
        </div>

        {/* Active filter chips */}
        {activeChips.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="tx-active-filters">
            {activeChips.map(chip => (
              <span key={chip.key} data-testid={`tx-filter-chip-${chip.key}`} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-primary/15 text-primary border border-primary/30">
                {chip.label}
                <button type="button" onClick={chip.clear} aria-label={`Remove filter ${chip.label}`} data-testid={`tx-filter-chip-remove-${chip.key}`} className="hover:text-white">
                  <X size={12} />
                </button>
              </span>
            ))}
            <button type="button" onClick={clearAllFilters} data-testid="tx-clear-all-filters" className="text-[11px] font-semibold text-slate-400 hover:text-white underline">
              Clear all
            </button>
          </div>
        )}

        {/* Filter drawer */}
        {filterDrawerOpen && (
          <div data-testid="tx-filter-drawer" className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <fieldset>
              <legend className="text-xs font-semibold text-slate-300 mb-2">Status (multi-select)</legend>
              <div className="space-y-1.5">
                {STATUSES.map(s => (
                  <label key={s} className="flex items-center gap-2 text-xs text-slate-400">
                    <input type="checkbox" checked={statusMulti.includes(s)} onChange={() => toggleStatusMulti(s)} data-testid={`tx-filter-status-${s}`} className="accent-blue-500" />
                    {s}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="tx-asset-filter" className="text-xs font-semibold text-slate-300 mb-2 block">Asset</label>
              <select id="tx-asset-filter" value={assetFilter} onChange={e => setAssetFilter(e.target.value)} data-testid="tx-asset-filter" className="input-field text-xs py-1.5 w-full">
                <option value="All">All Assets</option>
                {ASSETS.map(a => (<option key={a} value={a}>{a}</option>))}
              </select>
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-300 mb-2 block">Date range</span>
              <div className="flex flex-col gap-2">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} data-testid="tx-filter-date-from" aria-label="From date" className="input-field text-xs py-1.5" />
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} data-testid="tx-filter-date-to" aria-label="To date" className="input-field text-xs py-1.5" />
              </div>
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-300 mb-2 block">Amount range</span>
              <div className="flex flex-col gap-2">
                <input type="number" value={minAmount} onChange={e => setMinAmount(e.target.value)} placeholder="Min amount" data-testid="tx-filter-min-amount" aria-label="Minimum amount" className="input-field text-xs py-1.5" />
                <input type="number" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} placeholder="Max amount" data-testid="tx-filter-max-amount" aria-label="Maximum amount" className="input-field text-xs py-1.5" />
              </div>
            </div>
          </div>
        )}
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
              {itemsToRender.map(item => {
                const tx = item.tx;
                if (!tx) return null;
                const isExpanded = expandedTxIds.has(tx.id);

                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    data-testid={`tx-row-${item.index}`}
                    className="absolute top-0 left-0 w-full border-b border-slate-800/60 hover:bg-slate-900/60 transition-colors text-sm"
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
                              <span className="truncate max-w-[140px] sm:max-w-[200px]">{tx.hash}</span>
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
