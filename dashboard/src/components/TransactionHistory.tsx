import { useState, useMemo, useCallback } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronUp, ChevronDown, ChevronsUpDown, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { TransactionStatusBadge } from './TransactionStatusBadge';
import type { TransactionStatus } from './TransactionStatusBadge';

type TransactionType = 'Deposit' | 'Withdrawal';
type SortKey = 'type' | 'asset' | 'amount' | 'status' | 'date';
type SortDir = 'asc' | 'desc';

interface Transaction {
  id: string;
  type: TransactionType;
  asset: string;
  amount: number;
  status: TransactionStatus;
  date: string;
  reference: string;
}

const ALL_TRANSACTIONS: Transaction[] = Array.from({ length: 45 }, (_, i) => {
  const isDeposit = i % 3 === 0;
  const statusList: TransactionStatus[] = ['Completed', 'Pending', 'Processing', 'Failed', 'Cancelled'];
  const status = statusList[i % statusList.length];
  const assets = ['USDC', 'EURT', 'ARST'];
  const asset = assets[i % assets.length];
  const amount = 50 + (i * 25.5);
  // Generate dates going back in time
  const dateObj = new Date('2024-03-21');
  dateObj.setDate(dateObj.getDate() - Math.floor(i / 3));
  
  return {
    id: `tx-${String(i + 1).padStart(3, '0')}`,
    type: isDeposit ? 'Deposit' : 'Withdrawal',
    asset,
    amount,
    status,
    date: dateObj.toISOString().split('T')[0],
    reference: `REF-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
  };
});

const PAGE_SIZE_OPTIONS = [5, 10, 20] as const;

const fmtAmount = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SortIcon = ({ col, sortKey, dir }: { col: SortKey; sortKey: SortKey; dir: SortDir }) => {
  if (col !== sortKey) return <ChevronsUpDown size={13} className="text-slate-600" aria-hidden="true" />;
  return dir === 'asc'
    ? <ChevronUp size={13} className="text-primary" aria-hidden="true" />
    : <ChevronDown size={13} className="text-primary" aria-hidden="true" />;
};

export const TransactionHistory = () => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TransactionStatus | 'All'>('All');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(5);

  const handleSort = useCallback((key: SortKey) => {
    setSortDir((prev) => (sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
    setSortKey(key);
    setPage(1);
  }, [sortKey]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return ALL_TRANSACTIONS.filter((tx) => {
      const matchesQuery =
        !q ||
        tx.type.toLowerCase().includes(q) ||
        tx.asset.toLowerCase().includes(q) ||
        tx.reference.toLowerCase().includes(q) ||
        tx.status.toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'All' || tx.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [query, statusFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'amount') {
        cmp = a.amount - b.amount;
      } else {
        cmp = a[sortKey].localeCompare(b[sortKey]);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const HEADERS: { key: SortKey; label: string }[] = [
    { key: 'type',   label: 'Type'      },
    { key: 'asset',  label: 'Asset'     },
    { key: 'amount', label: 'Amount'    },
    { key: 'status', label: 'Status'    },
    { key: 'date',   label: 'Date'      },
  ];

  const statusOptions: Array<TransactionStatus | 'All'> = [
    'All', 'Completed', 'Pending', 'Processing', 'Failed', 'Cancelled',
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by type, asset, reference…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            aria-label="Search transactions"
            className="input-field w-full pl-9 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="sr-only">Filter by status</label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as TransactionStatus | 'All'); setPage(1); }}
            className="input-field text-sm"
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s}</option>
            ))}
          </select>

          <label htmlFor="page-size" className="sr-only">Rows per page</label>
          <select
            id="page-size"
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value) as typeof pageSize); setPage(1); }}
            className="input-field text-sm"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-x-auto">
        <table className="w-full text-left" aria-label="Transaction history">
          <caption className="sr-only">
            Transaction history — {sorted.length} result{sorted.length !== 1 ? 's' : ''}
          </caption>
          <thead>
            <tr className="border-b border-slate-800 text-sm text-slate-400">
              {HEADERS.map(({ key, label }) => (
                <th key={key} scope="col" className="p-4 font-medium">
                  <button
                    onClick={() => handleSort(key)}
                    className="inline-flex items-center gap-1 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
                    aria-label={`Sort by ${label}${sortKey === key ? `, currently ${sortDir}ending` : ''}`}
                  >
                    {label}
                    <SortIcon col={key} sortKey={sortKey} dir={sortDir} />
                  </button>
                </th>
              ))}
              <th scope="col" className="p-4 font-medium text-slate-400">Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  No transactions match your filters.
                </td>
              </tr>
            ) : (
              paginated.map((tx) => (
                <tr
                  key={tx.id}
                  className="transition-colors hover:bg-slate-900/50"
                >
                  <td className="flex items-center gap-2 p-4">
                    {tx.type === 'Deposit' ? (
                      <ArrowDownLeft size={16} className="text-emerald-400" aria-hidden="true" />
                    ) : (
                      <ArrowUpRight size={16} className="text-rose-400" aria-hidden="true" />
                    )}
                    {tx.type}
                  </td>
                  <td className="p-4">{tx.asset}</td>
                  <td className="p-4 font-mono">${fmtAmount(tx.amount)}</td>
                  <td className="p-4">
                    <TransactionStatusBadge status={tx.status} />
                  </td>
                  <td className="p-4 text-sm text-slate-400">
                    <time dateTime={tx.date}>{tx.date}</time>
                  </td>
                  <td className="p-4 font-mono text-xs text-slate-500">{tx.reference}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span aria-live="polite" aria-atomic="true">
          {sorted.length === 0
            ? 'No results'
            : `Showing ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sorted.length)} of ${sorted.length}`}
        </span>
        <div className="flex items-center gap-1" role="navigation" aria-label="Pagination">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            aria-label="Previous page"
            className="rounded p-1.5 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          {(() => {
            // Smart pagination window calculation
            const pages: (number | '...')[] = [];
            if (totalPages <= 5) {
              for (let i = 1; i <= totalPages; i++) pages.push(i);
            } else {
              if (safePage <= 3) {
                pages.push(1, 2, 3, 4, '...', totalPages);
              } else if (safePage >= totalPages - 2) {
                pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
              } else {
                pages.push(1, '...', safePage - 1, safePage, safePage + 1, '...', totalPages);
              }
            }

            return pages.map((p, idx) => {
              if (p === '...') {
                return (
                  <span key={`ellipsis-${idx}`} className="px-2 py-1 text-xs text-slate-500">
                    ...
                  </span>
                );
              }
              return (
                <button
                  key={`page-${p}`}
                  onClick={() => setPage(p as number)}
                  aria-label={`Page ${p}`}
                  aria-current={p === safePage ? 'page' : undefined}
                  className={`min-w-[2rem] rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                    p === safePage
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {p}
                </button>
              );
            });
          })()}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            aria-label="Next page"
            className="rounded p-1.5 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransactionHistory;
