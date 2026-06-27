import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { TransactionStatusBadge } from './TransactionStatusBadge';
import type { TransactionStatus } from './TransactionStatusBadge';

type TransactionType = 'Deposit' | 'Withdrawal';
type SortKey = 'type' | 'asset' | 'amount' | 'status' | 'date';
type SortDir = 'asc' | 'desc';
type ColumnAlign = 'left' | 'right';

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
  const amount = 50 + i * 25.5;
  const dateObj = new Date('2024-03-21');
  dateObj.setDate(dateObj.getDate() - Math.floor(i / 3));

  return {
    id: `tx-${String(i + 1).padStart(3, '0')}`,
    type: isDeposit ? 'Deposit' : 'Withdrawal',
    asset,
    amount,
    status,
    date: dateObj.toISOString().split('T')[0],
    reference: `REF-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
  };
});

const PAGE_SIZE_OPTIONS = [5, 10, 20] as const;

const fmtAmount = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SortIcon = ({ col, sortKey, dir }: { col: SortKey; sortKey: SortKey; dir: SortDir }) => {
  if (col !== sortKey) return <ChevronsUpDown size={13} className="text-slate-600" aria-hidden="true" />;
  return dir === 'asc' ? (
    <ChevronUp size={13} className="text-primary-text" aria-hidden="true" />
  ) : (
    <ChevronDown size={13} className="text-primary-text" aria-hidden="true" />
  );
};

export const TransactionHistory = () => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TransactionStatus | 'All'>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(5);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  const handleSort = useCallback(
    (key: SortKey) => {
      setSortDir((prev) => (sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
      setSortKey(key);
      setPage(1);
    },
    [sortKey],
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return ALL_TRANSACTIONS.filter((tx) => {
      const matchesQuery =
        !q ||
        tx.id.toLowerCase().includes(q) ||
        tx.type.toLowerCase().includes(q) ||
        tx.asset.toLowerCase().includes(q) ||
        tx.reference.toLowerCase().includes(q) ||
        tx.status.toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'All' || tx.status === statusFilter;
      const matchesFrom = !dateFrom || tx.date >= dateFrom;
      const matchesTo = !dateTo || tx.date <= dateTo;
      return matchesQuery && matchesStatus && matchesFrom && matchesTo;
    });
  }, [query, statusFilter, dateFrom, dateTo]);

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

  const HEADERS: { key: SortKey; label: string; align: ColumnAlign }[] = [
    { key: 'type', label: 'Type', align: 'left' },
    { key: 'asset', label: 'Asset', align: 'left' },
    { key: 'amount', label: 'Amount', align: 'right' },
    { key: 'status', label: 'Status', align: 'left' },
    { key: 'date', label: 'Date', align: 'left' },
  ];

  const statusOptions: Array<TransactionStatus | 'All'> = ['All', 'Completed', 'Pending', 'Processing', 'Failed', 'Cancelled'];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by ID, type, asset, reference…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            aria-label="Search transactions"
            className="input-field w-full pl-9 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="date-from" className="sr-only">
            From date
          </label>
          <input
            id="date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            aria-label="Filter from date"
            className="input-field text-sm"
          />
          <label htmlFor="date-to" className="sr-only">
            To date
          </label>
          <input
            id="date-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            aria-label="Filter to date"
            className="input-field text-sm"
          />

          <label htmlFor="status-filter" className="sr-only">
            Filter by status
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as TransactionStatus | 'All');
              setPage(1);
            }}
            className="input-field text-sm"
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {s === 'All' ? 'All Statuses' : s}
              </option>
            ))}
          </select>

          <label htmlFor="page-size" className="sr-only">
            Rows per page
          </label>
          <select
            id="page-size"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) as typeof pageSize);
              setPage(1);
            }}
            className="input-field text-sm"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="glass-card overflow-x-auto">
        <table className="responsive-table w-full text-left" aria-label="Transaction history">
          <caption className="sr-only">
            Transaction history — {sorted.length} result{sorted.length !== 1 ? 's' : ''}
          </caption>
          <thead>
            <tr className="border-b border-slate-600 text-sm text-slate-400">
              {HEADERS.map(({ key, label, align }) => (
                <th
                  key={key}
                  scope="col"
                  className={`p-4 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  <button
                    onClick={() => handleSort(key)}
                    className={`inline-flex items-center gap-1 rounded hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                      align === 'right' ? 'justify-end' : 'justify-start'
                    }`}
                    aria-label={`Sort by ${label}${sortKey === key ? `, currently ${sortDir}ending` : ''}`}
                  >
                    {label}
                    <SortIcon col={key} sortKey={sortKey} dir={sortDir} />
                  </button>
                </th>
              ))}
              <th scope="col" className="p-4 font-medium text-slate-400">
                Reference
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-600">
            {isLoading ? (
              Array.from({ length: pageSize }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="transition-colors hover:bg-slate-900/50">
                  <td className="p-4">
                    <div className="h-4 w-20 animate-pulse rounded bg-slate-800" />
                  </td>
                  <td className="p-4">
                    <div className="h-4 w-12 animate-pulse rounded bg-slate-800" />
                  </td>
                  <td className="p-4">
                    <div className="h-4 w-16 animate-pulse rounded bg-slate-800" />
                  </td>
                  <td className="p-4">
                    <div className="h-6 w-20 animate-pulse rounded-full bg-slate-800" />
                  </td>
                  <td className="p-4">
                    <div className="h-4 w-24 animate-pulse rounded bg-slate-800" />
                  </td>
                  <td className="p-4">
                    <div className="h-4 w-24 animate-pulse rounded bg-slate-800" />
                  </td>
                </tr>
              ))
            ) : paginated.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  No transactions match your filters.
                </td>
              </tr>
            ) : (
              paginated.map((tx) => (
                <tr key={tx.id} className="transition-colors hover:bg-slate-900/50">
                  <td className="flex items-center gap-2 p-4" data-label="Type">
                    {tx.type === 'Deposit' ? (
                      <ArrowDownLeft size={16} className="text-emerald-400" aria-hidden="true" />
                    ) : (
                      <ArrowUpRight size={16} className="text-rose-400" aria-hidden="true" />
                    )}
                    {tx.type}
                  </td>
                  <td className="p-4" data-label="Asset">{tx.asset}</td>
                  <td className="p-4 font-mono" data-label="Amount">${fmtAmount(tx.amount)}</td>
                  <td className="p-4" data-label="Status">
                    <TransactionStatusBadge status={tx.status} />
                  </td>
                  <td className="p-4 text-sm text-slate-400" data-label="Date">
                    <time dateTime={tx.date}>{tx.date}</time>
                  </td>
                  <td className="p-4 font-mono text-xs text-slate-500" data-label="Reference">{tx.reference}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
            className="rounded p-1.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          {(() => {
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
            return pages.map((p, idx) =>
              p === '...' ? (
                <span key={`ellipsis-${idx}`} className="px-2">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`rounded px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                    p === safePage ? 'bg-primary text-white' : 'hover:bg-slate-800'
                  }`}
                  aria-current={p === safePage ? 'page' : undefined}
                >
                  {p}
                </button>
              ),
            );
          })()}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            aria-label="Next page"
            className="rounded p-1.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransactionHistory;
