import { useEffect, useMemo, useState } from 'react';
import { Search, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { LogoMark } from './LogoMark';
import { MetricsChart } from './MetricsChart';
import { DashboardOverviewSkeleton } from './Skeletons';
import { StakingCalculator } from './StakingCalculator';
import { TransactionStatusBadge, type TransactionStatus } from './TransactionStatusBadge';
import type { UiConfig } from '../types';

export type StatusFilter = 'All' | 'Pending' | 'Completed' | 'Failed';

interface OverviewTransaction {
  id: string;
  type: 'Deposit' | 'Withdrawal';
  asset: string;
  amount: number;
  status: TransactionStatus;
  date: string;
  reference: string;
}

type DashboardOverviewProps = {
  uiConfig: UiConfig;
  /** Renders pulsing placeholders instead of a blank panel while stats load. */
  isLoading?: boolean;
};

const STATUS_FILTERS: StatusFilter[] = ['All', 'Pending', 'Completed', 'Failed'];

const OVERVIEW_TRANSACTIONS: OverviewTransaction[] = Array.from({ length: 12 }, (_, i) => {
  const isDeposit = i % 3 === 0;
  const statusList: TransactionStatus[] = ['Completed', 'Pending', 'Failed', 'Processing', 'Cancelled'];
  const status = statusList[i % statusList.length];
  const assets = ['USDC', 'EURT', 'ARST'];
  const dateObj = new Date('2024-03-21');
  dateObj.setDate(dateObj.getDate() - Math.floor(i / 2));

  return {
    id: `ov-tx-${String(i + 1).padStart(3, '0')}`,
    type: isDeposit ? 'Deposit' : 'Withdrawal',
    asset: assets[i % assets.length],
    amount: 50 + i * 25.5,
    status,
    date: dateObj.toISOString().split('T')[0],
    reference: `REF-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
  };
});

const fmtAmount = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Maps an arbitrary URL `status` value to a supported filter. Unknown values
 * fall back to `All` so a stale or hand-edited URL cannot break the view.
 */
export function parseStatusFilter(value: string | null): StatusFilter {
  switch (value) {
    case 'pending':
    case 'completed':
    case 'failed':
      return value.charAt(0).toUpperCase() + value.slice(1) as StatusFilter;
    default:
      return 'All';
  }
}

/** Reads the current `?status=` filter from the URL (works in jsdom + browser). */
export function readStatusFilterFromUrl(): StatusFilter {
  const params = new URLSearchParams(window.location.search);
  return parseStatusFilter(params.get('status'));
}

/** Writes the selected filter into the URL without triggering a page reload. */
export function writeStatusFilterToUrl(filter: StatusFilter): void {
  const url = new URL(window.location.href);
  if (filter === 'All') {
    url.searchParams.delete('status');
  } else {
    url.searchParams.set('status', filter.toLowerCase());
  }
  window.history.replaceState(null, '', url.toString());
}

export const DashboardOverview = ({ uiConfig, isLoading = false }: DashboardOverviewProps) => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(readStatusFilterFromUrl);
  const [query, setQuery] = useState('');

  // Keep the URL in sync with the selected filter (`?status=pending`).
  useEffect(() => {
    writeStatusFilterToUrl(statusFilter);
  }, [statusFilter]);

  const filteredTransactions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return OVERVIEW_TRANSACTIONS.filter((tx) => {
      const matchesStatus =
        statusFilter === 'All' ||
        (statusFilter === 'Pending' && tx.status === 'Pending') ||
        (statusFilter === 'Completed' && tx.status === 'Completed') ||
        (statusFilter === 'Failed' && tx.status === 'Failed');
      const matchesQuery =
        !q ||
        tx.id.toLowerCase().includes(q) ||
        tx.type.toLowerCase().includes(q) ||
        tx.asset.toLowerCase().includes(q) ||
        tx.reference.toLowerCase().includes(q) ||
        tx.status.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [statusFilter, query]);

  // Metric summaries reflect the active filter.
  const stats = useMemo(() => {
    const totalVolume = filteredTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    const deposits = filteredTransactions.filter((tx) => tx.type === 'Deposit').length;
    const pending = filteredTransactions.filter((tx) => tx.status === 'Pending').length;
    return [
      {
        label: 'Filtered Volume',
        value: `$${fmtAmount(totalVolume)}`,
        change: filteredTransactions.length > 0 ? `${filteredTransactions.length} tx` : '0 tx',
      },
      { label: 'Deposits', value: String(deposits), change: `${filteredTransactions.length} total` },
      { label: 'Pending Withdrawals', value: String(pending), change: statusFilter },
    ];
  }, [filteredTransactions, statusFilter]);

  if (isLoading) {
    return <DashboardOverviewSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="glass-card p-6">
            <p className="text-sm text-slate-400">{stat.label}</p>
            <div className="mt-2 flex items-end justify-between">
              <h3 className="font-display text-2xl font-bold">{stat.value}</h3>
              <span className="text-xs text-slate-400" aria-label={`Summary: ${stat.change}`}>
                {stat.change}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="glass-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                aria-pressed={statusFilter === filter}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                  statusFilter === filter
                    ? 'border-primary bg-primary text-white'
                    : 'border-slate-600 bg-slate-950/50 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>

          <div className="relative max-w-xs flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search transactions…"
              aria-label="Quick search transactions"
              className="input-field w-full pl-9 text-sm"
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {filteredTransactions.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No transactions match the selected filters.
            </p>
          ) : (
            filteredTransactions.slice(0, 6).map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-950/30 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  {tx.type === 'Deposit' ? (
                    <ArrowDownLeft size={16} className="text-emerald-400" aria-hidden="true" />
                  ) : (
                    <ArrowUpRight size={16} className="text-rose-400" aria-hidden="true" />
                  )}
                  <div>
                    <p className="text-sm font-medium">
                      {tx.type} · {tx.asset}
                    </p>
                    <p className="text-xs text-slate-500">
                      <time dateTime={tx.date}>{tx.date}</time> · {tx.reference}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm">${fmtAmount(tx.amount)}</span>
                  <TransactionStatusBadge status={tx.status} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="glass-card p-6">
          <MetricsChart />
        </div>
        <div className="space-y-6">
          <div className="glass-card p-6">
            <h3 className="font-display text-xl font-bold">Anchor Branding</h3>
            <div className="mt-5 flex items-center gap-4">
              <LogoMark uiConfig={uiConfig} />
              <div>
                <p className="font-medium">{uiConfig.brandName}</p>
                <p className="text-sm text-slate-400">
                  {uiConfig.supportEmail ?? 'Support contact not configured'}
                </p>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-600 bg-slate-950/50 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Primary</p>
                <div className="mt-3 flex items-center gap-3">
                  <span
                    className="h-6 w-6 rounded-full border border-white/10"
                    style={{ backgroundColor: uiConfig.primaryColor }}
                    aria-label={`Primary color: ${uiConfig.primaryColor}`}
                  />
                  <span className="font-mono text-sm" aria-hidden="true">
                    {uiConfig.primaryColor}
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-slate-600 bg-slate-950/50 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Accent</p>
                <div className="mt-3 flex items-center gap-3">
                  <span
                    className="h-6 w-6 rounded-full border border-white/10"
                    style={{ backgroundColor: uiConfig.accentColor }}
                    aria-label={`Accent color: ${uiConfig.accentColor}`}
                  />
                  <span className="font-mono text-sm" aria-hidden="true">
                    {uiConfig.accentColor}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="glass-card p-6">
            <StakingCalculator />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardOverview;
