import React, { useEffect, useId, useMemo, useState } from 'react';
import { Coins, Fuel, LockKeyhole, Percent, RefreshCw, TrendingUp } from 'lucide-react';
import { Modal } from './Modal';

export const LOCK_DURATION_OPTIONS = [30, 90, 180, 365] as const;
export type LockDurationDays = (typeof LOCK_DURATION_OPTIONS)[number];

export const BASE_APY = 4.8;
export const LOCK_MULTIPLIERS: Record<LockDurationDays, number> = {
  30: 1,
  90: 1.35,
  180: 1.7,
  365: 2.1,
};

export const LOCK_TIER_NAMES: Record<LockDurationDays, string> = {
  30: 'Bronze (30d)',
  90: 'Silver (90d)',
  180: 'Titanium (180d)',
  365: 'Gold (365d)',
};

export interface StakingPoolParameters {
  totalPoolStaked: number;
  annualRewardPool: number;
  baseApr: number;
  protocolFeeRate: number; // e.g. 0.02 (2.0%)
  estimatedGasFee: number; // e.g. 0.01 APX
}

export const DEFAULT_POOL_PARAMETERS: StakingPoolParameters = {
  totalPoolStaked: 1_000_000,
  annualRewardPool: 48_000,
  baseApr: 4.8,
  protocolFeeRate: 0.02,
  estimatedGasFee: 0.01,
};

export function calculateEstimatedApy(
  lockDurationDays: LockDurationDays,
  baseApr: number = BASE_APY
): number {
  const multiplier = LOCK_MULTIPLIERS[lockDurationDays] ?? 1;
  return Number((baseApr * multiplier).toFixed(2));
}

/**
 * Clamps a deposit to a usable amount: zero, negative, empty or non-numeric
 * input all count as nothing staked rather than propagating NaN.
 */
export function normalizeDepositAmount(depositAmount: number): number {
  return Number.isFinite(depositAmount) && depositAmount > 0 ? depositAmount : 0;
}

/**
 * Compound interest formula with daily compounding (n = 365):
 * A = P * (1 + r / 365)^(days)
 * Gross Compounded Earnings = A - P
 */
export function calculateCompoundedEarnings(
  depositAmount: number,
  lockDurationDays: number,
  aprPercent: number = BASE_APY,
  compoundingFrequency: number = 365
): number {
  const p = normalizeDepositAmount(depositAmount);
  if (p === 0 || lockDurationDays <= 0 || aprPercent <= 0) return 0;
  const r = aprPercent / 100;
  const n = compoundingFrequency;
  const t = lockDurationDays / 365;
  const total = p * Math.pow(1 + r / n, n * t);
  return Number((total - p).toFixed(2));
}

export function calculateProtocolFee(
  grossRewards: number,
  protocolFeeRate: number = 0.02
): number {
  if (grossRewards <= 0 || protocolFeeRate <= 0) return 0;
  return Number((grossRewards * protocolFeeRate).toFixed(2));
}

export function calculateNetReturn(
  grossRewards: number,
  protocolFee: number,
  gasFee: number = 0
): number {
  return Number(Math.max(0, grossRewards - protocolFee - gasFee).toFixed(2));
}

/**
 * Linear projected rewards helper (retained for backward compatibility)
 */
export function calculateProjectedRewards(
  depositAmount: number,
  lockDurationDays: LockDurationDays,
  aprPercent?: number
): number {
  const amount = normalizeDepositAmount(depositAmount);
  if (amount === 0) return 0;
  const apy = (aprPercent ?? calculateEstimatedApy(lockDurationDays)) / 100;
  return Number((amount * apy * (lockDurationDays / 365)).toFixed(2));
}

export const formatTokenAmount = (amount: number) =>
  (Number.isFinite(amount) ? amount : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export interface StakingCalculatorProps {
  /** If provided, renders inside an accessible Modal dialog; otherwise renders inline */
  isOpen?: boolean;
  onClose?: () => void;
  /** Invoked when user clicks "Stake Now", passing the chosen amount and duration */
  onStakeNow?: (amount: number, duration: LockDurationDays) => void;
  apiBaseUrl?: string;
  initialAmount?: number;
  initialDuration?: LockDurationDays;
}

export const StakingCalculator: React.FC<StakingCalculatorProps> = ({
  isOpen,
  onClose,
  onStakeNow,
  apiBaseUrl = 'http://localhost:3002',
  initialAmount = 2_500,
  initialDuration = 90,
}) => {
  const [depositAmount, setDepositAmount] = useState<number>(initialAmount);
  const [lockDuration, setLockDuration] = useState<LockDurationDays>(initialDuration);
  const [poolParams, setPoolParams] = useState<StakingPoolParameters>(DEFAULT_POOL_PARAMETERS);
  const [isLoadingPool, setIsLoadingPool] = useState(false);
  const titleId = useId();

  // Fetch active staking contract pool parameters dynamically
  useEffect(() => {
    if (isOpen === false) return;
    let active = true;
    const fetchPoolParams = async () => {
      setIsLoadingPool(true);
      try {
        const res = await fetch(`${apiBaseUrl}/api/staking/pool-parameters`).catch(() => null);
        if (res && res.ok && active) {
          const json = await res.json();
          if (json?.data) {
            setPoolParams({
              totalPoolStaked: Number(json.data.totalPoolStaked ?? DEFAULT_POOL_PARAMETERS.totalPoolStaked),
              annualRewardPool: Number(json.data.annualRewardPool ?? DEFAULT_POOL_PARAMETERS.annualRewardPool),
              baseApr: Number(json.data.baseApr ?? DEFAULT_POOL_PARAMETERS.baseApr),
              protocolFeeRate: Number(json.data.protocolFeeRate ?? DEFAULT_POOL_PARAMETERS.protocolFeeRate),
              estimatedGasFee: Number(json.data.estimatedGasFee ?? DEFAULT_POOL_PARAMETERS.estimatedGasFee),
            });
          }
        }
      } catch {
        // Fall back to default pool parameters
      } finally {
        if (active) setIsLoadingPool(false);
      }
    };

    fetchPoolParams();
    return () => {
      active = false;
    };
  }, [apiBaseUrl, isOpen]);

  const estimatedApy = useMemo(
    () => calculateEstimatedApy(lockDuration, poolParams.baseApr),
    [lockDuration, poolParams.baseApr]
  );

  const compoundedEarnings = useMemo(
    () => calculateCompoundedEarnings(depositAmount, lockDuration, estimatedApy),
    [depositAmount, lockDuration, estimatedApy]
  );

  const protocolFee = useMemo(
    () => calculateProtocolFee(compoundedEarnings, poolParams.protocolFeeRate),
    [compoundedEarnings, poolParams.protocolFeeRate]
  );

  const netReturn = useMemo(
    () => calculateNetReturn(compoundedEarnings, protocolFee, poolParams.estimatedGasFee),
    [compoundedEarnings, protocolFee, poolParams.estimatedGasFee]
  );

  const projectedBalance = normalizeDepositAmount(depositAmount) + netReturn;

  const handleStakeNow = () => {
    onStakeNow?.(normalizeDepositAmount(depositAmount), lockDuration);
  };

  const content = (
    <div className="space-y-6 text-slate-100">
      {/* Header if not in modal */}
      {isOpen === undefined && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3
              id={titleId}
              className="font-display text-xl font-bold text-slate-100"
            >
              Staking yield estimator
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Estimate rewards by deposit size and lock period with compounding returns and fee breakdown.
            </p>
          </div>
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-2 text-primary-text">
            <Calculator size={20} aria-hidden="true" />
          </div>
        </div>
      )}

      {/* Pool status bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3.5 py-2.5 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Active Pool Base APR: <strong className="text-emerald-300 font-mono">{poolParams.baseApr.toFixed(2)}%</strong></span>
        </div>
        <div className="flex items-center gap-3">
          <span>Fee: <strong className="text-slate-300">{(poolParams.protocolFeeRate * 100).toFixed(1)}%</strong></span>
          <span>Gas Est: <strong className="text-slate-300 font-mono">{poolParams.estimatedGasFee} APX</strong></span>
          {isLoadingPool && <RefreshCw size={12} className="animate-spin text-slate-400" />}
        </div>
      </div>

      {/* Stake Amount input */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="staking-deposit-amount" className="text-sm font-medium text-slate-300">
            Deposit amount
          </label>
          <output
            htmlFor="staking-deposit-amount"
            aria-label="Selected deposit amount"
            className="font-mono text-sm font-semibold text-slate-100"
          >
            {formatTokenAmount(depositAmount)} APX
          </output>
        </div>
        <input
          id="staking-deposit-amount"
          type="range"
          min={0}
          max={100_000}
          step={100}
          value={depositAmount}
          onChange={(event) => setDepositAmount(normalizeDepositAmount(Number(event.target.value)))}
          className="w-full accent-[var(--primary)] cursor-pointer"
        />
        <div className="flex flex-wrap items-center gap-2">
          {[1_000, 5_000, 10_000, 25_000, 50_000].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setDepositAmount(preset)}
              className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 text-xs text-slate-300 hover:border-slate-700 hover:text-white transition-colors"
            >
              +{formatTokenAmount(preset)}
            </button>
          ))}
        </div>
      </div>

      {/* Lock Duration selector */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <LockKeyhole size={16} aria-hidden="true" />
          <span>Lock duration</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Lock duration">
          {LOCK_DURATION_OPTIONS.map((days) => {
            const apy = calculateEstimatedApy(days, poolParams.baseApr);
            const isSelected = lockDuration === days;
            return (
              <button
                key={days}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setLockDuration(days)}
                className={`flex flex-col items-center justify-center rounded-xl border p-3 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                  isSelected
                    ? 'border-primary bg-primary/20 text-white shadow-sm shadow-primary/20 ring-1 ring-primary'
                    : 'border-slate-800 bg-slate-950/50 text-slate-300 hover:bg-slate-800 hover:border-slate-700'
                }`}
              >
                <span className="text-sm font-bold">{days}d</span>
                <span className="mt-1 text-xs text-emerald-400 font-mono font-semibold">{apy.toFixed(2)}% APR</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Summary metric cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400 font-medium">Est. APR</p>
          <p className="mt-1.5 font-mono text-xl font-bold text-emerald-400">
            {estimatedApy.toFixed(2)}%
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Tier: {LOCK_TIER_NAMES[lockDuration]}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400 font-medium">Gross Rewards</p>
          <p className="mt-1.5 font-mono text-xl font-bold text-slate-100">
            {formatTokenAmount(compoundedEarnings)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Compounded daily</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400 font-medium">Net Projected</p>
          <p className="mt-1.5 font-mono text-xl font-bold text-slate-100">
            {formatTokenAmount(projectedBalance)}
          </p>
          <p className="mt-1 text-[11px] text-emerald-400 font-mono">+{formatTokenAmount(netReturn)} APX net</p>
        </div>
      </div>

      {/* Itemized Fee Breakdown */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-2.5 text-xs">
        <div className="flex items-center justify-between text-slate-400">
          <span>Gross Projected Rewards</span>
          <span className="font-mono text-slate-200">+{formatTokenAmount(compoundedEarnings)} APX</span>
        </div>
        <div className="flex items-center justify-between text-slate-400">
          <span className="flex items-center gap-1.5">
            <Percent size={13} className="text-amber-400" aria-hidden="true" />
            Protocol Fee ({(poolParams.protocolFeeRate * 100).toFixed(1)}%)
          </span>
          <span className="font-mono text-amber-300">-{formatTokenAmount(protocolFee)} APX</span>
        </div>
        <div className="flex items-center justify-between text-slate-400">
          <span className="flex items-center gap-1.5">
            <Fuel size={13} className="text-blue-400" aria-hidden="true" />
            Est. Transaction Gas Cost
          </span>
          <span className="font-mono text-blue-300">~{formatTokenAmount(poolParams.estimatedGasFee)} APX</span>
        </div>
        <div className="border-t border-slate-800 pt-2 flex items-center justify-between font-semibold text-slate-200">
          <span className="text-slate-300">Net Estimated Return</span>
          <span className="font-mono text-emerald-400">+{formatTokenAmount(netReturn)} APX</span>
        </div>
      </div>

      {/* Compounding note */}
      <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-200">
        <TrendingUp size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          Projections apply daily compound interest across lock tiers. Longer lockups earn higher APR multipliers with rewards claimable upon unlock.
        </p>
      </div>

      {/* Direct Stake Now Button */}
      <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="action-button w-full sm:w-auto rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            Close
          </button>
        )}
        <button
          type="button"
          onClick={handleStakeNow}
          className="action-button btn-primary w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text transition-all"
        >
          <Coins size={16} aria-hidden="true" />
          <span>Stake Now</span>
        </button>
      </div>
    </div>
  );

  if (isOpen !== undefined) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose ?? (() => {})}
        title="Staking yield estimator"
        description="Simulate compounding earnings, APR, and itemized net returns across lockup tiers."
        size="lg"
      >
        {content}
      </Modal>
    );
  }

  return (
    <section aria-labelledby={titleId} className="space-y-5">
      {content}
    </section>
  );
};

export default StakingCalculator;
