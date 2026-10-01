import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { 
  AlertTriangle, 
  ShieldAlert, 
  ShieldCheck, 
  ArrowUpDown, 
  Flame, 
  Search, 
  RefreshCw, 
  Wallet, 
  ExternalLink,
  CheckCircle2,
  TrendingDown,
  Pause,
  Play,
  Radio,
  Clock,
  Activity
} from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';

export interface VaultRecord {
  id: string;
  borrower: string;
  collateralAsset: string;
  collateralAmount: number;
  collateralPrice: number;
  debtAsset: string;
  debtAmount: number;
  debtPrice: number;
  liquidationThreshold: number; // e.g. 0.8 for 80%
  healthFactor?: number;
  status?: 'liquidatable' | 'at_risk' | 'healthy' | 'liquidated';
}

// ---------------------------------------------------------------------------
// Oracle Price Feed Types
// ---------------------------------------------------------------------------

export interface PriceFeed {
  id: string;
  asset: string;
  price: number;
  timestamp: number;
  source: 'stellar' | 'coinbase' | 'binance' | 'manual';
  status: 'active' | 'stale' | 'failed';
}

/**
 * Staleness threshold in seconds (300s = 5 minutes)
 */
export const ORACLE_STALENESS_THRESHOLD_SECONDS = 300;

/**
 * Computes the age of a price feed in seconds
 */
export function computeFeedAgeSeconds(timestamp: number): number {
  return Math.floor(Date.now() / 1000) - timestamp;
}

/**
 * Determines the status of a price feed based on its timestamp
 */
export function computePriceFeedStatus(timestamp: number): 'active' | 'stale' | 'failed' {
  const age = computeFeedAgeSeconds(timestamp);
  if (age > ORACLE_STALENESS_THRESHOLD_SECONDS * 2) {
    return 'failed';
  }
  if (age > ORACLE_STALENESS_THRESHOLD_SECONDS) {
    return 'stale';
  }
  return 'active';
}

/**
 * Formats the age of a price feed for display
 */
export function formatFeedAge(timestamp: number): string {
  const age = computeFeedAgeSeconds(timestamp);
  if (age < 60) {
    return `${age}s ago`;
  }
  if (age < 3600) {
    return `${Math.floor(age / 60)}m ago`;
  }
  return `${Math.floor(age / 3600)}h ago`;
}

// Mock oracle price feeds for the monitoring panel
export const INITIAL_PRICE_FEEDS: PriceFeed[] = [
  {
    id: 'feed-xlm-usd',
    asset: 'XLM/USD',
    price: 0.1234,
    timestamp: Math.floor(Date.now() / 1000) - 15, // 15 seconds old
    source: 'stellar',
    status: 'active',
  },
  {
    id: 'feed-usdc-usd',
    asset: 'USDC/USD',
    price: 1.0001,
    timestamp: Math.floor(Date.now() / 1000) - 45, // 45 seconds old
    source: 'coinbase',
    status: 'active',
  },
  {
    id: 'feed-eurt-usd',
    asset: 'EURT/USD',
    price: 1.0823,
    timestamp: Math.floor(Date.now() / 1000) - 180, // 3 minutes old
    source: 'binance',
    status: 'active',
  },
  {
    id: 'feed-arst-usd',
    asset: 'ARST/USD',
    price: 0.4521,
    timestamp: Math.floor(Date.now() / 1000) - 320, // ~5.3 minutes old - STALE
    source: 'stellar',
    status: 'stale',
  },
  {
    id: 'feed-usdt-usd',
    asset: 'USDT/USD',
    price: 0.9998,
    timestamp: Math.floor(Date.now() / 1000) - 650, // ~10.8 minutes old - FAILED
    source: 'manual',
    status: 'failed',
  },
  {
    id: 'feed-brlc-usd',
    asset: 'BRLC/USD',
    price: 0.1987,
    timestamp: Math.floor(Date.now() / 1000) - 90, // 1.5 minutes old
    source: 'stellar',
    status: 'active',
  },
];

/**
 * Computes the Health Factor of a vault.
 * HF = (Collateral Amount * Collateral Price * Liquidation Threshold) / (Debt Amount * Debt Price)
 * If debt is 0, Health Factor is Infinity (safe).
 */
export function computeHealthFactor(
  collateralAmount: number,
  collateralPrice: number,
  debtAmount: number,
  debtPrice: number,
  liquidationThreshold: number = 0.8
): number {
  const debtValue = debtAmount * debtPrice;
  if (debtValue <= 0) return Infinity;
  const collateralValue = collateralAmount * collateralPrice;
  if (collateralValue <= 0) return 0;
  const hf = (collateralValue * liquidationThreshold) / debtValue;
  return Number(hf.toFixed(4));
}

/**
 * Sorts vault records by Health Factor.
 */
export function sortVaultsByHealthFactor(
  vaults: VaultRecord[],
  direction: 'asc' | 'desc' = 'asc'
): VaultRecord[] {
  return [...vaults].sort((a, b) => {
    const hfA = a.healthFactor ?? computeHealthFactor(
      a.collateralAmount,
      a.collateralPrice,
      a.debtAmount,
      a.debtPrice,
      a.liquidationThreshold
    );
    const hfB = b.healthFactor ?? computeHealthFactor(
      b.collateralAmount,
      b.collateralPrice,
      b.debtAmount,
      b.debtPrice,
      b.liquidationThreshold
    );

    if (direction === 'asc') {
      return hfA - hfB;
    } else {
      return hfB - hfA;
    }
  });
}

// Initial mock vaults for the monitor panel
export const INITIAL_VAULTS: VaultRecord[] = [
  {
    id: 'VAULT-1092',
    borrower: 'GDV5...9P2K',
    collateralAsset: 'XLM',
    collateralAmount: 50000,
    collateralPrice: 0.12,
    debtAsset: 'USDC',
    debtAmount: 4800,
    debtPrice: 1.0,
    liquidationThreshold: 0.8, // (50000 * 0.12 * 0.8) / 4800 = 1.00 -> Liquidatable (< 1.1)
  },
  {
    id: 'VAULT-1088',
    borrower: 'GA7R...3ML9',
    collateralAsset: 'USDC',
    collateralAmount: 12000,
    collateralPrice: 1.0,
    debtAsset: 'EURT',
    debtAmount: 9200,
    debtPrice: 1.08,
    liquidationThreshold: 0.85, // (12000 * 1.0 * 0.85) / (9200 * 1.08) = 10200 / 9936 = 1.0266 -> Liquidatable (< 1.1)
  },
  {
    id: 'VAULT-1045',
    borrower: 'GC3X...7WK1',
    collateralAsset: 'yXLM',
    collateralAmount: 85000,
    collateralPrice: 0.13,
    debtAsset: 'USDC',
    debtAmount: 8300,
    debtPrice: 1.0,
    liquidationThreshold: 0.8, // (85000 * 0.13 * 0.8) / 8300 = 8840 / 8300 = 1.0651 -> Liquidatable (< 1.1)
  },
  {
    id: 'VAULT-1077',
    borrower: 'GB8M...2VN4',
    collateralAsset: 'XLM',
    collateralAmount: 140000,
    collateralPrice: 0.12,
    debtAsset: 'USDC',
    debtAmount: 11000,
    debtPrice: 1.0,
    liquidationThreshold: 0.8, // (140000 * 0.12 * 0.8) / 11000 = 1.2218 -> At Risk
  },
  {
    id: 'VAULT-1012',
    borrower: 'GDF4...8PL0',
    collateralAsset: 'USDC',
    collateralAmount: 35000,
    collateralPrice: 1.0,
    debtAsset: 'USDC',
    debtAmount: 18000,
    debtPrice: 1.0,
    liquidationThreshold: 0.85, // (35000 * 0.85) / 18000 = 1.6528 -> Healthy
  },
  {
    id: 'VAULT-1004',
    borrower: 'GBK1...5WQ8',
    collateralAsset: 'XLM',
    collateralAmount: 500000,
    collateralPrice: 0.12,
    debtAsset: 'USDC',
    debtAmount: 20000,
    debtPrice: 1.0,
    liquidationThreshold: 0.8, // (500000 * 0.12 * 0.8) / 20000 = 2.4000 -> Healthy
  }
];

interface AdminWidgetsProps {
  initialVaults?: VaultRecord[];
  isLiquidatorConnected?: boolean;
  onLiquidateVault?: (vaultId: string) => Promise<void> | void;
}

export const AdminWidgets: React.FC<AdminWidgetsProps> = ({
  initialVaults = INITIAL_VAULTS,
  isLiquidatorConnected: initialWalletConnected = true,
  onLiquidateVault
}) => {
  const [vaults, setVaults] = useState<VaultRecord[]>(() => {
    return initialVaults.map(v => ({
      ...v,
      healthFactor: computeHealthFactor(
        v.collateralAmount,
        v.collateralPrice,
        v.debtAmount,
        v.debtPrice,
        v.liquidationThreshold
      ),
      status: computeHealthFactor(
        v.collateralAmount,
        v.collateralPrice,
        v.debtAmount,
        v.debtPrice,
        v.liquidationThreshold
      ) < 1.1 ? 'liquidatable' : (
        computeHealthFactor(
          v.collateralAmount,
          v.collateralPrice,
          v.debtAmount,
          v.debtPrice,
          v.liquidationThreshold
        ) < 1.5 ? 'at_risk' : 'healthy'
      )
    }));
  });

  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterType, setFilterType] = useState<'all' | 'undercollateralized' | 'healthy'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isWalletConnected, setIsWalletConnected] = useState(initialWalletConnected);
  const [liquidatingId, setLiquidatingId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'warning' } | null>(null);

  // Compute enriched & sorted vaults
  const processedVaults = useMemo(() => {
    let result = vaults.map(v => {
      const hf = computeHealthFactor(
        v.collateralAmount,
        v.collateralPrice,
        v.debtAmount,
        v.debtPrice,
        v.liquidationThreshold
      );
      let status = v.status;
      if (status !== 'liquidated') {
        status = hf < 1.1 ? 'liquidatable' : (hf < 1.5 ? 'at_risk' : 'healthy');
      }
      return {
        ...v,
        healthFactor: hf,
        status
      };
    });

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(v => 
        v.id.toLowerCase().includes(query) ||
        v.borrower.toLowerCase().includes(query) ||
        v.collateralAsset.toLowerCase().includes(query) ||
        v.debtAsset.toLowerCase().includes(query)
      );
    }

    if (filterType === 'undercollateralized') {
      result = result.filter(v => (v.healthFactor ?? 2) < 1.1);
    } else if (filterType === 'healthy') {
      result = result.filter(v => (v.healthFactor ?? 0) >= 1.5);
    }

    return sortVaultsByHealthFactor(result, sortDirection);
  }, [vaults, sortDirection, filterType, searchQuery]);

  const underCollateralizedCount = useMemo(() => {
    return vaults.filter(v => (v.healthFactor ?? 2) < 1.1 && v.status !== 'liquidated').length;
  }, [vaults]);

  const totalAtRiskCollateralUSD = useMemo(() => {
    return vaults
      .filter(v => (v.healthFactor ?? 2) < 1.1 && v.status !== 'liquidated')
      .reduce((acc, v) => acc + (v.collateralAmount * v.collateralPrice), 0);
  }, [vaults]);

  const toggleSort = () => {
    setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  const handleTriggerLiquidation = async (vault: VaultRecord) => {
    if (!isWalletConnected) {
      setNotification({
        message: 'Please connect a liquidator wallet to execute liquidation transactions.',
        type: 'warning'
      });
      return;
    }

    setLiquidatingId(vault.id);
    try {
      if (onLiquidateVault) {
        await onLiquidateVault(vault.id);
      } else {
        // Simulated liquidation delay
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      setVaults(prev => prev.map(v => {
        if (v.id === vault.id) {
          return {
            ...v,
            status: 'liquidated',
            debtAmount: 0,
            healthFactor: Infinity
          };
        }
        return v;
      }));

      setNotification({
        message: `Liquidation executed successfully for ${vault.id}! Collateral seized & debt settled.`,
        type: 'success'
      });
    } catch {
      setNotification({
        message: `Failed to liquidate ${vault.id}. Please check contract liquidity.`,
        type: 'warning'
      });
    } finally {
      setLiquidatingId(null);
    }
  };

  // Helper to simulate market volatility
  const handleSimulatePriceDrop = () => {
    setVaults(prev => prev.map(v => {
      if (v.collateralAsset === 'XLM' || v.collateralAsset === 'yXLM') {
        const newPrice = Number((v.collateralPrice * 0.92).toFixed(4));
        return { ...v, collateralPrice: newPrice };
      }
      return v;
    }));
    setNotification({
      message: 'Simulated market shock: XLM collateral price dropped by 8%. Health factors recomputed!',
      type: 'warning'
    });
  };

  const handleResetVaults = () => {
    setVaults(INITIAL_VAULTS.map(v => ({
      ...v,
      healthFactor: computeHealthFactor(
        v.collateralAmount,
        v.collateralPrice,
        v.debtAmount,
        v.debtPrice,
        v.liquidationThreshold
      ),
      status: computeHealthFactor(
        v.collateralAmount,
        v.collateralPrice,
        v.debtAmount,
        v.debtPrice,
        v.liquidationThreshold
      ) < 1.1 ? 'liquidatable' : 'healthy'
    })));
    setNotification(null);
  };

  return (
    <div className="space-y-6" data-testid="liquidation-vaults-panel">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className={`glass-card p-5 border ${underCollateralizedCount > 0 ? 'border-rose-500/40 bg-rose-950/20' : 'border-slate-800'}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-rose-400 flex items-center gap-1.5">
              <AlertTriangle size={16} /> Under-Collateralized
            </span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-500/20 text-rose-300">
              HF &lt; 1.1
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold font-display text-rose-400" data-testid="under-collateralized-count">
              {underCollateralizedCount}
            </span>
            <span className="text-xs text-rose-300/80">Vaults Requiring Action</span>
          </div>
        </div>

        <div className="glass-card p-5 border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-slate-400">Total Monitored</span>
            <ShieldCheck size={16} className="text-blue-400" />
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold font-display text-slate-100">{vaults.length}</span>
            <span className="text-xs text-slate-400">Active Borrow Positions</span>
          </div>
        </div>

        <div className="glass-card p-5 border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-slate-400">At-Risk Collateral</span>
            <TrendingDown size={16} className="text-amber-400" />
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold font-display text-amber-400">
              ${totalAtRiskCollateralUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs text-slate-400">USD Valuation</span>
          </div>
        </div>

        <div className="glass-card p-5 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-slate-400">Liquidator Bot</span>
            <button
              onClick={() => setIsWalletConnected(!isWalletConnected)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors ${
                isWalletConnected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              data-testid="toggle-liquidator-wallet"
            >
              <Wallet size={14} />
              {isWalletConnected ? 'Connected' : 'Connect'}
            </button>
          </div>
          <div className="mt-2 text-xs text-slate-400">
            {isWalletConnected ? 'Wallet ready for 1-click on-chain liquidation.' : 'Connect wallet to execute transactions.'}
          </div>
        </div>
      </div>

      {/* Notification Banner */}
      {notification && (
        <div className={`p-4 rounded-xl border flex items-center justify-between ${
          notification.type === 'success' 
            ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300' 
            : 'bg-amber-950/30 border-amber-500/30 text-amber-300'
        }`}>
          <div className="flex items-center gap-2 text-sm font-medium">
            {notification.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            {notification.message}
          </div>
          <button 
            onClick={() => setNotification(null)}
            className="text-xs opacity-75 hover:opacity-100 uppercase font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Table Toolbar */}
      <div className="glass-card p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by Vault ID, Borrower (G...), or Asset..."
                className="input-field w-full pl-9 text-sm"
                data-testid="vault-search-input"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="bg-slate-900 border border-slate-800 p-1 rounded-lg flex items-center text-xs">
              <button
                onClick={() => setFilterType('all')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  filterType === 'all' ? 'bg-primary text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All Vaults ({vaults.length})
              </button>
              <button
                onClick={() => setFilterType('undercollateralized')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                  filterType === 'undercollateralized' ? 'bg-rose-500 text-white' : 'text-slate-400 hover:text-rose-400'
                }`}
                data-testid="filter-undercollateralized"
              >
                <AlertTriangle size={12} /> Under-Collateralized ({underCollateralizedCount})
              </button>
              <button
                onClick={() => setFilterType('healthy')}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  filterType === 'healthy' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-emerald-400'
                }`}
              >
                Healthy
              </button>
            </div>

            <button
              onClick={handleSimulatePriceDrop}
              className="px-3 py-2 bg-slate-900 border border-slate-700 hover:border-slate-500 text-xs font-semibold rounded-lg text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors"
              title="Simulate 8% drop in XLM price to test liquidation triggers"
            >
              <TrendingDown size={14} className="text-rose-400" />
              Market Shock
            </button>

            <button
              onClick={handleResetVaults}
              className="p-2 bg-slate-900 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white rounded-lg transition-colors"
              title="Reset data"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Sortable Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" data-testid="liquidation-table">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                <th className="p-4">Vault ID</th>
                <th className="p-4">Borrower</th>
                <th className="p-4">Collateral</th>
                <th className="p-4">Debt</th>
                <th className="p-4">Liq. Threshold</th>
                <th className="p-4 cursor-pointer select-none hover:text-white transition-colors" onClick={toggleSort} data-testid="sort-health-factor">
                  <div className="flex items-center gap-1.5">
                    <span>Health Factor</span>
                    <ArrowUpDown size={14} className={sortDirection === 'asc' ? 'text-primary' : 'text-slate-400'} />
                  </div>
                </th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Liquidation Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {processedVaults.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No vaults found matching current filters.
                  </td>
                </tr>
              ) : (
                processedVaults.map(vault => {
                  const hf = vault.healthFactor ?? 0;
                  const isUnderCollateralized = hf < 1.1 && vault.status !== 'liquidated';
                  const isLiquidated = vault.status === 'liquidated';
                  const collateralUSD = vault.collateralAmount * vault.collateralPrice;
                  const debtUSD = vault.debtAmount * vault.debtPrice;

                  return (
                    <tr
                      key={vault.id}
                      data-testid={`vault-row-${vault.id}`}
                      className={`transition-colors ${
                        isUnderCollateralized
                          ? 'bg-rose-950/30 hover:bg-rose-950/40 border-l-4 border-l-rose-500'
                          : isLiquidated
                          ? 'opacity-50 bg-slate-900/30'
                          : 'hover:bg-slate-900/50'
                      }`}
                    >
                      <td className="p-4 font-mono font-medium text-slate-200">
                        {vault.id}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
                          <span>{vault.borrower}</span>
                          <ExternalLink size={12} className="cursor-pointer hover:text-primary" />
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-slate-200">
                          {vault.collateralAmount.toLocaleString()} {vault.collateralAsset}
                        </div>
                        <div className="text-xs text-slate-500">
                          ${collateralUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-slate-200">
                          {vault.debtAmount.toLocaleString()} {vault.debtAsset}
                        </div>
                        <div className="text-xs text-slate-500">
                          ${debtUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </td>
                      <td className="p-4 font-mono text-slate-400 text-xs">
                        {(vault.liquidationThreshold * 100).toFixed(0)}%
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span
                            data-testid={`health-factor-${vault.id}`}
                            className={`font-mono font-bold text-base ${
                              isUnderCollateralized
                                ? 'text-rose-400 animate-pulse'
                                : hf < 1.5
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                            }`}
                          >
                            {hf === Infinity ? '∞' : hf.toFixed(2)}
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        {isLiquidated ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-400">
                            Liquidated
                          </span>
                        ) : isUnderCollateralized ? (
                          <span
                            data-testid={`status-badge-${vault.id}`}
                            className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1 w-max"
                          >
                            <AlertTriangle size={12} /> Liquidatable
                          </span>
                        ) : hf < 1.5 ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            At Risk
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            Solvent
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        {isLiquidated ? (
                          <span className="text-xs text-slate-500 italic">Settled</span>
                        ) : isUnderCollateralized ? (
                          <button
                            data-testid={`trigger-liquidation-${vault.id}`}
                            disabled={liquidatingId === vault.id}
                            onClick={() => handleTriggerLiquidation(vault)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/40 transition-all active:scale-95 disabled:opacity-50"
                          >
                            <Flame size={14} />
                            {liquidatingId === vault.id ? 'Liquidating...' : 'Trigger Liquidation'}
                          </button>
                        ) : (
                          <button
                            disabled
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800/60 text-slate-500 cursor-not-allowed"
                          >
                            <ShieldCheck size={14} />
                            Safe
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// PauseControlsWidget
// ---------------------------------------------------------------------------

/** Feature flag names backing each pause level. */
const PAUSE_LEVELS = [
  {
    key: 'sep24.enabled',
    label: 'Global Pause',
    description: 'Disables all SEP-24 hosted deposit and withdrawal flows anchor-wide.',
  },
  {
    key: 'sep24.deposit',
    label: 'Deposits Paused',
    description: 'Blocks new SEP-24 hosted deposits while withdrawals continue normally.',
  },
  {
    key: 'contract.swap',
    label: 'Swaps Paused',
    description: 'Disables Swap contract interactions.',
  },
] as const;

interface FeatureFlagState {
  enabled: boolean;
}

interface PauseControlsWidgetProps {
  /** Base URL of the backend API, e.g. "http://localhost:3002" */
  apiBaseUrl: string;
}

const PauseControlsWidget: React.FC<PauseControlsWidgetProps> = ({ apiBaseUrl }) => {
  const [flags, setFlags] = useState<Record<string, FeatureFlagState>>({});
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [pendingLevel, setPendingLevel] = useState<(typeof PAUSE_LEVELS)[number] | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = localStorage.getItem('authToken');
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  const fetchFlags = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/feature-flags`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const body = await res.json();
      const next: Record<string, FeatureFlagState> = {};
      for (const flag of (body.data ?? []) as { name: string; enabled: boolean }[]) {
        next[flag.name] = { enabled: flag.enabled };
      }
      setFlags(next);
    } catch (err) {
      setStatusMessage({
        text: err instanceof Error ? err.message : 'Failed to load pause status.',
        isError: true,
      });
    }
  }, [apiBaseUrl, authHeaders]);

  useEffect(() => {
    void fetchFlags();
  }, [fetchFlags]);

  const isPaused = (levelKey: string): boolean => flags[levelKey]?.enabled === false;

  const showStatus = (text: string, isError: boolean) => {
    setStatusMessage({ text, isError });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  const handleToggleConfirm = async () => {
    if (!pendingLevel) return;
    const level = pendingLevel;
    setPendingLevel(null);
    setLoading(true);

    const nextAction = isPaused(level.key) ? 'enable' : 'disable';

    try {
      const res = await fetch(`${apiBaseUrl}/feature-flags/${level.key}/${nextAction}`, {
        method: 'PUT',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to update '${level.label}'`);

      setFlags((prev) => ({ ...prev, [level.key]: { enabled: nextAction === 'enable' } }));
      showStatus(
        `${level.label} ${nextAction === 'enable' ? 'resumed' : 'paused'} successfully.`,
        false,
      );
    } catch (err) {
      showStatus(err instanceof Error ? err.message : `Failed to update '${level.label}'.`, true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-card p-6">
      <h3 className="mb-1 flex items-center gap-2 text-lg font-bold text-slate-100">
        <ShieldAlert size={18} className="text-rose-400" aria-hidden="true" />
        Emergency Pause Controls
      </h3>
      <p className="mb-4 text-sm text-slate-400">
        Toggling a pause level takes effect immediately and requires confirmation.
      </p>

      {statusMessage && (
        <div
          role="alert"
          className={`mb-4 rounded-lg border p-3 text-sm ${
            statusMessage.isError
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      <div className="space-y-3">
        {PAUSE_LEVELS.map((level) => {
          const paused = isPaused(level.key);
          return (
            <div
              key={level.key}
              className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-slate-200">{level.label}</h4>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      paused ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {paused ? 'Paused' : 'Active'}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">{level.description}</p>
              </div>
              <button
                type="button"
                onClick={() => setPendingLevel(level)}
                disabled={loading}
                className={`action-button flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-40 ${
                  paused
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20'
                }`}
              >
                {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                {paused ? 'Resume' : 'Pause'}
              </button>
            </div>
          );
        })}
      </div>

      <ConfirmModal
        isOpen={pendingLevel !== null}
        title={pendingLevel ? `${isPaused(pendingLevel.key) ? 'Resume' : 'Pause'} ${pendingLevel.label}?` : ''}
        message={
          pendingLevel
            ? isPaused(pendingLevel.key)
              ? `Are you sure you want to resume "${pendingLevel.label}"? This will restore normal operation immediately.`
              : `Are you sure you want to pause "${pendingLevel.label}"? This will take effect immediately for all users.`
            : ''
        }
        confirmText={pendingLevel ? (isPaused(pendingLevel.key) ? 'Resume' : 'Pause') : 'Confirm'}
        isDanger={pendingLevel ? !isPaused(pendingLevel.key) : true}
        onConfirm={() => void handleToggleConfirm()}
        onCancel={() => setPendingLevel(null)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// OracleMonitor — Real-time price feed monitoring with staleness warnings
// ---------------------------------------------------------------------------

interface OracleMonitorProps {
  /** Base URL of the backend API, e.g. "http://localhost:3002" */
  apiBaseUrl?: string;
  /** Initial price feeds to display (defaults to mock data) */
  initialPriceFeeds?: PriceFeed[];
  /** Callback when a stale feed is detected */
  onStaleFeedDetected?: (feed: PriceFeed) => void;
}

export const OracleMonitor: React.FC<OracleMonitorProps> = ({
  apiBaseUrl = '',
  initialPriceFeeds = INITIAL_PRICE_FEEDS,
  onStaleFeedDetected,
}) => {
  const [priceFeeds, setPriceFeeds] = useState<PriceFeed[]>(() => {
    return initialPriceFeeds.map((feed) => ({
      ...feed,
      status: computePriceFeedStatus(feed.timestamp),
    }));
  });
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'warning' | 'error' } | null>(null);

  // Fetch price feeds from API
  const fetchPriceFeeds = useCallback(async () => {
    if (!apiBaseUrl) {
      // Simulate live updates with mock data when no API is available
      setPriceFeeds((prev) =>
        prev.map((feed) => {
          // Randomly update some feeds to simulate live updates
          const shouldUpdate = Math.random() > 0.7;
          const newTimestamp = shouldUpdate ? Math.floor(Date.now() / 1000) : feed.timestamp;
          const newPrice = shouldUpdate
            ? +(feed.price * (1 + (Math.random() - 0.5) * 0.02)).toFixed(4)
            : feed.price;
          return {
            ...feed,
            timestamp: newTimestamp,
            price: newPrice,
            status: computePriceFeedStatus(newTimestamp),
          };
        })
      );
      setLastRefresh(new Date());
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/oracle/price-feeds`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const body = await res.json();
      const feeds: PriceFeed[] = (body.data ?? body).map((feed: PriceFeed) => ({
        ...feed,
        status: computePriceFeedStatus(feed.timestamp),
      }));
      setPriceFeeds(feeds);
      setLastRefresh(new Date());
      setStatusMessage({ text: 'Price feeds updated successfully', type: 'success' });
    } catch (err) {
      setStatusMessage({
        text: err instanceof Error ? err.message : 'Failed to fetch price feeds',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchPriceFeeds();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchPriceFeeds]);

  // Check for stale feeds and trigger callback
  useEffect(() => {
    const staleFeeds = priceFeeds.filter((f) => f.status === 'stale' || f.status === 'failed');
    staleFeeds.forEach((feed) => {
      onStaleFeedDetected?.(feed);
    });
  }, [priceFeeds, onStaleFeedDetected]);

  // Compute statistics
  const stats = useMemo(() => {
    const total = priceFeeds.length;
    const active = priceFeeds.filter((f) => f.status === 'active').length;
    const stale = priceFeeds.filter((f) => f.status === 'stale').length;
    const failed = priceFeeds.filter((f) => f.status === 'failed').length;
    return { total, active, stale, failed };
  }, [priceFeeds]);

  const getSourceIcon = (source: PriceFeed['source']) => {
    const icons = {
      stellar: '⋆',
      coinbase: 'C',
      binance: 'B',
      manual: 'M',
    };
    return icons[source];
  };

  return (
    <div className="space-y-6" data-testid="oracle-monitor-panel">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card p-5 border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-slate-400 flex items-center gap-1.5">
              <Radio size={16} className="text-emerald-400" /> Active Feeds
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold font-display text-emerald-400">{stats.active}</span>
            <span className="text-xs text-slate-400">of {stats.total} total</span>
          </div>
        </div>

        <div className={`glass-card p-5 border ${stats.stale > 0 ? 'border-amber-500/40 bg-amber-950/20' : 'border-slate-800'}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-amber-400 flex items-center gap-1.5">
              <AlertTriangle size={16} /> Stale Feeds
            </span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/20 text-amber-300">
              &gt; 5 min
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold font-display text-amber-400">{stats.stale}</span>
            <span className="text-xs text-amber-300/80">Needs attention</span>
          </div>
        </div>

        <div className={`glass-card p-5 border ${stats.failed > 0 ? 'border-rose-500/40 bg-rose-950/20' : 'border-slate-800'}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-rose-400 flex items-center gap-1.5">
              <ShieldAlert size={16} /> Failed Feeds
            </span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-500/20 text-rose-300">
              &gt; 10 min
            </span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-3xl font-bold font-display text-rose-400">{stats.failed}</span>
            <span className="text-xs text-rose-300/80">Critical</span>
          </div>
        </div>

        <div className="glass-card p-5 border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-bold tracking-wider text-slate-400">Last Update</span>
            <Clock size={16} className="text-blue-400" />
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-xl font-bold font-display text-slate-100">
              {lastRefresh.toLocaleTimeString()}
            </span>
            <span className="text-xs text-slate-400">Auto-refresh: 10s</span>
          </div>
        </div>
      </div>

      {/* Status Message */}
      {statusMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
              : statusMessage.type === 'warning'
              ? 'bg-amber-950/30 border-amber-500/30 text-amber-300'
              : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            {statusMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            {statusMessage.text}
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-xs opacity-75 hover:opacity-100 uppercase font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Price Feeds Table */}
      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-primary" />
            <h3 className="font-semibold text-slate-200">Price Feed Status</h3>
          </div>
          <button
            onClick={() => void fetchPriceFeeds()}
            disabled={isLoading}
            className="px-3 py-2 bg-slate-900 border border-slate-700 hover:border-slate-500 text-xs font-semibold rounded-lg text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors disabled:opacity-50"
            data-testid="oracle-refresh-button"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" data-testid="price-feeds-table">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider font-semibold">
                <th className="p-4">Asset Pair</th>
                <th className="p-4">Price</th>
                <th className="p-4">Source</th>
                <th className="p-4">Last Update</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {priceFeeds.map((feed) => {
                const age = computeFeedAgeSeconds(feed.timestamp);
                const isStale = feed.status === 'stale';
                const isFailed = feed.status === 'failed';

                return (
                  <tr
                    key={feed.id}
                    data-testid={`price-feed-${feed.id}`}
                    className={`transition-colors ${
                      isFailed
                        ? 'bg-rose-950/30 hover:bg-rose-950/40 border-l-4 border-l-rose-500'
                        : isStale
                        ? 'bg-amber-950/30 hover:bg-amber-950/40 border-l-4 border-l-amber-500'
                        : 'hover:bg-slate-900/50'
                    }`}
                  >
                    <td className="p-4 font-medium text-slate-200">{feed.asset}</td>
                    <td className="p-4 font-mono text-slate-200">
                      ${feed.price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-xs font-bold text-slate-400">
                        {getSourceIcon(feed.source)}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <Clock size={14} />
                        <span className="font-mono text-xs">{formatFeedAge(feed.timestamp)}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      {isFailed ? (
                        <span
                          data-testid={`feed-status-badge-${feed.id}`}
                          className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1 w-max"
                        >
                          <AlertTriangle size={12} /> Failed
                        </span>
                      ) : isStale ? (
                        <span
                          data-testid={`feed-status-badge-${feed.id}`}
                          className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1 w-max"
                        >
                          <AlertTriangle size={12} /> Stale
                        </span>
                      ) : (
                        <span
                          data-testid={`feed-status-badge-${feed.id}`}
                          className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 w-max"
                        >
                          <Radio size={12} /> Live
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export { PauseControlsWidget };
export { OracleMonitor };
export default AdminWidgets;
