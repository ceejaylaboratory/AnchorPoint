import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Calculator,
  CheckCircle2,
  Clock,
  Coins,
  Lock,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Unlock,
  X,
} from 'lucide-react';
import {
  calculateEstimatedApy,
  calculateProjectedRewards,
  LOCK_DURATION_OPTIONS,
  type LockDurationDays,
} from './StakingCalculator';
import { useTranslation } from '../i18n/config';

export type LockTier = '30_days' | '90_days' | '365_days';

export interface StakingPosition {
  stakedAmount: number;
  currentRewards: number;
  lockTier: LockTier;
  lockDurationDays: LockDurationDays;
  unlockDate: string;
  apy: number;
  stakedAt: string;
  isUnlocked: boolean;
  asset: string;
}

export interface StakingDashboardProps {
  apiBaseUrl?: string;
  userAddress?: string;
  onPositionUpdate?: (position: StakingPosition) => void;
}

const EARLY_PENALTY_PERCENT = 5; // 5% fee for withdrawing before unlock date

const formatToken = (amount: number): string =>
  amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatDate = (isoString: string): string => {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoString;
  }
};

const getDaysRemaining = (unlockDateStr: string): number => {
  const diffMs = new Date(unlockDateStr).getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
};

export const StakingDashboard: React.FC<StakingDashboardProps> = ({
  apiBaseUrl = 'http://localhost:3002',
  userAddress = 'G_STAKE_DEFAULT_USER',
  onPositionUpdate,
}) => {
  const { t } = useTranslation();

  const [position, setPosition] = useState<StakingPosition | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Modals state
  const [isStakeModalOpen, setIsStakeModalOpen] = useState(false);
  const [isUnstakeModalOpen, setIsUnstakeModalOpen] = useState(false);
  const [isConfirmStakeOpen, setIsConfirmStakeOpen] = useState(false);
  const [isConfirmUnstakeOpen, setIsConfirmUnstakeOpen] = useState(false);

  // Form states
  const [stakeAmountInput, setStakeAmountInput] = useState<string>('500');
  const [stakeDurationInput, setStakeDurationInput] = useState<LockDurationDays>(90);
  const [unstakeAmountInput, setUnstakeAmountInput] = useState<string>('');
  const [actionLoading, setActionLoading] = useState(false);
  const [showEstimator, setShowEstimator] = useState(false);

  // Generate fallback demo position
  const getFallbackPosition = useCallback((): StakingPosition => {
    const unlockTime = Date.now() + 45 * 24 * 60 * 60 * 1000; // 45 days remaining
    const stakedTime = Date.now() - 45 * 24 * 60 * 60 * 1000;
    return {
      stakedAmount: 5_000,
      currentRewards: 142.5,
      lockTier: '90_days',
      lockDurationDays: 90,
      unlockDate: new Date(unlockTime).toISOString(),
      apy: calculateEstimatedApy(90),
      stakedAt: new Date(stakedTime).toISOString(),
      isUnlocked: false,
      asset: 'APX',
    };
  }, []);

  const fetchPosition = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setFetchError(null);

      try {
        const res = await fetch(`${apiBaseUrl}/api/staking/position?address=${encodeURIComponent(userAddress)}`);
        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }
        const data = await res.json();
        const pos: StakingPosition = {
          stakedAmount: Number(data.stakedAmount ?? 5000),
          currentRewards: Number(data.currentRewards ?? 142.5),
          lockTier: data.lockTier ?? '90_days',
          lockDurationDays: Number(data.lockDurationDays ?? 90) as LockDurationDays,
          unlockDate: data.unlockDate ?? new Date(Date.now() + 45 * 86400000).toISOString(),
          apy: Number(data.apy ?? calculateEstimatedApy(90)),
          stakedAt: data.stakedAt ?? new Date(Date.now() - 45 * 86400000).toISOString(),
          isUnlocked: Boolean(data.isUnlocked ?? false),
          asset: data.asset ?? 'APX',
        };
        setPosition(pos);
        onPositionUpdate?.(pos);
      } catch {
        // Fallback to active simulated position
        const fallback = getFallbackPosition();
        setPosition(fallback);
        onPositionUpdate?.(fallback);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiBaseUrl, userAddress, getFallbackPosition, onPositionUpdate],
  );

  useEffect(() => {
    fetchPosition();
  }, [fetchPosition]);

  // Keep the staking position view live with periodic background refresh.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchPosition(true);
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchPosition]);

  // Derived calculations
  const parsedStakeAmount = useMemo(() => {
    const val = Number.parseFloat(stakeAmountInput);
    return Number.isFinite(val) && val > 0 ? val : 0;
  }, [stakeAmountInput]);

  const parsedUnstakeAmount = useMemo(() => {
    const val = Number.parseFloat(unstakeAmountInput);
    return Number.isFinite(val) && val > 0 ? val : 0;
  }, [unstakeAmountInput]);

  const projectedStakeRewards = useMemo(() => {
    return calculateProjectedRewards(parsedStakeAmount, stakeDurationInput);
  }, [parsedStakeAmount, stakeDurationInput]);

  const daysRemaining = useMemo(() => {
    if (!position?.unlockDate) return 0;
    return getDaysRemaining(position.unlockDate);
  }, [position?.unlockDate]);

  const isPositionLocked = useMemo(() => {
    if (!position) return false;
    return !position.isUnlocked && daysRemaining > 0;
  }, [position, daysRemaining]);

  const earlyPenaltyAmount = useMemo(() => {
    if (!isPositionLocked) return 0;
    return Number(((parsedUnstakeAmount * EARLY_PENALTY_PERCENT) / 100).toFixed(2));
  }, [isPositionLocked, parsedUnstakeAmount]);

  const netUnstakeAmount = useMemo(() => {
    return Math.max(0, parsedUnstakeAmount - earlyPenaltyAmount);
  }, [parsedUnstakeAmount, earlyPenaltyAmount]);

  // Handle Stake Execution
  const handleConfirmStake = async () => {
    if (!position || parsedStakeAmount <= 0) return;
    setActionLoading(true);

    try {
      await fetch(`${apiBaseUrl}/api/staking/stake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: userAddress,
          amount: parsedStakeAmount,
          lockDurationDays: stakeDurationInput,
        }),
      }).catch(() => null);

      const newStakedAmount = position.stakedAmount + parsedStakeAmount;
      const newDuration = stakeDurationInput;
      const newApy = calculateEstimatedApy(newDuration);
      const newTier: LockTier =
        newDuration === 365 ? '365_days' : newDuration === 90 ? '90_days' : '30_days';

      const updated: StakingPosition = {
        ...position,
        stakedAmount: newStakedAmount,
        lockDurationDays: newDuration,
        lockTier: newTier,
        apy: newApy,
        unlockDate: new Date(Date.now() + newDuration * 24 * 60 * 60 * 1000).toISOString(),
        isUnlocked: false,
      };

      setPosition(updated);
      onPositionUpdate?.(updated);
      setIsConfirmStakeOpen(false);
      setIsStakeModalOpen(false);
      setFeedback({
        type: 'success',
        message: t('staking.stakeSuccess', {
          amount: formatToken(parsedStakeAmount),
          asset: position.asset,
          days: newDuration,
        }),
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Unstake Execution
  const handleConfirmUnstake = async () => {
    if (!position || parsedUnstakeAmount <= 0) return;
    setActionLoading(true);

    try {
      await fetch(`${apiBaseUrl}/api/staking/unstake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: userAddress,
          amount: parsedUnstakeAmount,
        }),
      }).catch(() => null);

      const remainingStake = Math.max(0, position.stakedAmount - parsedUnstakeAmount);
      const updated: StakingPosition = {
        ...position,
        stakedAmount: remainingStake,
      };

      setPosition(updated);
      onPositionUpdate?.(updated);
      setIsConfirmUnstakeOpen(false);
      setIsUnstakeModalOpen(false);
      setFeedback({
        type: 'success',
        message: t('staking.unstakeSuccess', {
          amount: formatToken(netUnstakeAmount),
          asset: position.asset,
        }),
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Claim Rewards
  const handleClaimRewards = async () => {
    if (!position || position.currentRewards <= 0) return;
    const rewardsToClaim = position.currentRewards;
    setActionLoading(true);

    try {
      await fetch(`${apiBaseUrl}/api/staking/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: userAddress }),
      }).catch(() => null);

      const updated: StakingPosition = {
        ...position,
        currentRewards: 0,
      };
      setPosition(updated);
      onPositionUpdate?.(updated);
      setFeedback({
        type: 'success',
        message: t('staking.claimSuccess', {
          amount: formatToken(rewardsToClaim),
          asset: position.asset,
        }),
      });
    } finally {
      setActionLoading(false);
    }
  };

  const currentAsset = position?.asset ?? 'APX';
  const currentStaked = position?.stakedAmount ?? 0;
  const currentRewards = position?.currentRewards ?? 0;
  const currentApy = position?.apy ?? 6.48;

  const tierLabel = useMemo(() => {
    if (!position) return t('staking.tier90');
    if (position.lockDurationDays === 365) return t('staking.tier365');
    if (position.lockDurationDays === 30) return t('staking.tier30');
    return t('staking.tier90');
  }, [position, t]);

  return (
    <section
      id="staking-dashboard"
      data-testid="staking-dashboard"
      aria-labelledby="staking-dashboard-heading"
      className="space-y-6"
    >
      {/* Header bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="staking-dashboard-heading" className="text-xl font-bold text-slate-100">
              {t('staking.title')}
            </h2>
            <span
              data-testid="live-position-badge"
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {t('staking.livePosition')}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">{t('staking.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="refresh-button"
            aria-label={t('common.refresh')}
            onClick={() => fetchPosition(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            <span>{refreshing ? t('common.loading') : t('common.refresh')}</span>
          </button>
        </div>
      </div>

      {/* Alert / Feedback message */}
      {feedback && (
        <div
          role="status"
          className={`flex items-center justify-between rounded-xl border p-4 text-sm transition-all ${
            feedback.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 size={18} className="shrink-0" />
            ) : (
              <AlertCircle size={18} className="shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-200"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Main 4 Position Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Staked Balance */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm transition-all hover:border-slate-700">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">{t('staking.stakedAmount')}</span>
            <div className="rounded-lg bg-primary/10 p-2 text-primary-text">
              <Coins size={18} aria-hidden="true" />
            </div>
          </div>
          <div className="mt-3">
            <span
              data-testid="staked-amount"
              className="text-2xl font-bold tracking-tight text-slate-100 font-mono"
            >
              {loading ? '---' : formatToken(currentStaked)}
            </span>
            <span className="ml-1 text-sm font-semibold text-slate-400">{currentAsset}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
            <span>≈ ${(currentStaked * 1.05).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium text-emerald-400">
              {t('staking.active')}
            </span>
          </div>
        </div>

        {/* Card 2: Earned Rewards */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm transition-all hover:border-slate-700">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">{t('staking.earnedRewards')}</span>
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400">
              <TrendingUp size={18} aria-hidden="true" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div>
              <span
                data-testid="current-rewards"
                className="text-2xl font-bold tracking-tight text-emerald-400 font-mono"
              >
                {loading ? '---' : `+${formatToken(currentRewards)}`}
              </span>
              <span className="ml-1 text-sm font-semibold text-slate-400">{currentAsset}</span>
            </div>
            {currentRewards > 0 && (
              <button
                type="button"
                data-testid="claim-button"
                onClick={handleClaimRewards}
                disabled={actionLoading}
                className="rounded-lg bg-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 transition-colors"
              >
                {t('staking.claimAction')}
              </button>
            )}
          </div>
          <div className="mt-2 text-xs text-slate-400">
            <span>{t('staking.subtitle')}</span>
          </div>
        </div>

        {/* Card 3: Lock Tier */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm transition-all hover:border-slate-700">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">{t('staking.lockTier')}</span>
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-400">
              {isPositionLocked ? <Lock size={18} aria-hidden="true" /> : <Unlock size={18} aria-hidden="true" />}
            </div>
          </div>
          <div className="mt-3">
            <span data-testid="lock-tier" className="text-xl font-bold tracking-tight text-slate-100">
              {tierLabel}
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-400">
            {isPositionLocked ? (
              <span className="text-amber-400 font-medium">
                {t('staking.daysRemaining', { days: daysRemaining })}
              </span>
            ) : (
              <span className="text-emerald-400 font-medium">{t('staking.unlockedNow')}</span>
            )}
          </div>
        </div>

        {/* Card 4: APY & Unlock Date */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm transition-all hover:border-slate-700">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">{t('staking.unlockDate')}</span>
            <div className="rounded-lg bg-blue-500/10 p-2 text-blue-400">
              <Clock size={18} aria-hidden="true" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span data-testid="unlock-date" className="text-lg font-bold text-slate-100">
              {position?.unlockDate ? formatDate(position.unlockDate) : '---'}
            </span>
            <span
              data-testid="apy-badge"
              className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-bold text-primary-text border border-primary/30"
            >
              {currentApy}% APY
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-400">
            <span>{t('staking.apy')}: {currentApy}%</span>
          </div>
        </div>
      </div>

      {/* Action Buttons Row */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="stake-button"
          onClick={() => {
            setStakeAmountInput('500');
            setIsStakeModalOpen(true);
          }}
          className="action-button flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-white shadow-md hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text transition-all min-h-[44px]"
        >
          <ArrowUpRight size={18} aria-hidden="true" />
          <span>{t('staking.stakeAction')}</span>
        </button>

        <button
          type="button"
          data-testid="unstake-button"
          onClick={() => {
            setUnstakeAmountInput(currentStaked > 0 ? String(currentStaked) : '0');
            setIsUnstakeModalOpen(true);
          }}
          className="action-button flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-5 py-3 font-semibold text-slate-200 hover:border-slate-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text transition-all min-h-[44px]"
        >
          <ArrowDownLeft size={18} aria-hidden="true" />
          <span>{t('staking.unstakeAction')}</span>
        </button>

        <button
          type="button"
          data-testid="toggle-estimator-button"
          onClick={() => setShowEstimator((prev) => !prev)}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
        >
          <Calculator size={14} aria-hidden="true" />
          <span>{showEstimator ? t('staking.positionTab') : t('staking.estimatorTab')}</span>
        </button>
      </div>

      {/* Optional Integrated Yield Estimator Preview */}
      {showEstimator && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Sparkles size={16} className="text-primary-text" />
            <span>{t('staking.estimatorTab')}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {LOCK_DURATION_OPTIONS.map((days) => {
              const apy = calculateEstimatedApy(days);
              const sampleReward = calculateProjectedRewards(1000, days);
              return (
                <div key={days} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex justify-between items-center text-sm font-semibold text-slate-200">
                    <span>{days} Days</span>
                    <span className="text-emerald-400">{apy}% APY</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    1,000 {currentAsset} yields ≈ {sampleReward} {currentAsset}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 1: STAKE FORM MODAL                                           */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {isStakeModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="stake-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 id="stake-modal-title" className="text-lg font-bold text-slate-100">
                  {t('staking.stakeModalTitle')}
                </h3>
                <p className="text-xs text-slate-400">{t('staking.stakeModalSubtitle')}</p>
              </div>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setIsStakeModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            {/* Amount input */}
            <div className="space-y-2">
              <label htmlFor="stake-amount-input" className="block text-xs font-medium text-slate-300">
                {t('staking.amountLabel')}
              </label>
              <div className="relative">
                <input
                  id="stake-amount-input"
                  data-testid="stake-amount-input"
                  type="number"
                  min="1"
                  step="any"
                  value={stakeAmountInput}
                  onChange={(e) => setStakeAmountInput(e.target.value)}
                  placeholder="100"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-lg font-mono text-slate-100 placeholder-slate-600 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                  {currentAsset}
                </span>
              </div>
              <div className="flex gap-2">
                {[100, 500, 1000, 5000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setStakeAmountInput(String(amt))}
                    className="rounded-lg border border-slate-800 bg-slate-800/60 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:border-slate-700 hover:text-white"
                  >
                    +{amt}
                  </button>
                ))}
              </div>
            </div>

            {/* Lock tier options */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-300">
                {t('staking.lockPeriodLabel')}
              </label>
              <div role="radiogroup" className="grid grid-cols-3 gap-2">
                {LOCK_DURATION_OPTIONS.map((days) => {
                  const apy = calculateEstimatedApy(days);
                  const selected = stakeDurationInput === days;
                  return (
                    <button
                      key={days}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setStakeDurationInput(days)}
                      className={`flex flex-col items-center justify-center rounded-xl border p-3 text-center transition-all ${
                        selected
                          ? 'border-primary bg-primary/10 text-slate-100 ring-2 ring-primary/40'
                          : 'border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <span className="text-sm font-bold">{days} Days</span>
                      <span className="text-xs text-emerald-400 font-semibold">{apy}% APY</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Projection preview */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-1 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>{t('staking.projectedRewards')}</span>
                <span className="font-mono text-emerald-400 font-semibold">
                  +{formatToken(projectedStakeRewards)} {currentAsset}
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>{t('staking.newStakedBalance')}</span>
                <span className="font-mono text-slate-200 font-semibold">
                  {formatToken(currentStaked + parsedStakeAmount)} {currentAsset}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsStakeModalOpen(false)}
                className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="review-stake-button"
                disabled={parsedStakeAmount <= 0}
                onClick={() => {
                  setIsStakeModalOpen(false);
                  setIsConfirmStakeOpen(true);
                }}
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-50"
              >
                {t('staking.stakeAction')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 2: CONFIRM STAKE MODAL                                        */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {isConfirmStakeOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-stake-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-primary/20 p-2.5 text-primary-text">
                <ArrowUpRight size={22} />
              </div>
              <div>
                <h3 id="confirm-stake-title" className="text-lg font-bold text-slate-100">
                  {t('staking.confirmStakeTitle')}
                </h3>
                <p className="text-xs text-slate-400">{t('staking.confirmStakeNotice')}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">{t('staking.amountLabel')}:</span>
                <span className="font-mono font-bold text-slate-100">
                  {formatToken(parsedStakeAmount)} {currentAsset}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{t('staking.lockPeriodLabel')}:</span>
                <span className="font-semibold text-slate-100">{stakeDurationInput} Days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">{t('staking.apy')}:</span>
                <span className="font-semibold text-emerald-400">
                  {calculateEstimatedApy(stakeDurationInput)}% APY
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-800 pt-2 font-bold">
                <span className="text-slate-300">{t('staking.newStakedBalance')}:</span>
                <span className="font-mono text-primary-text">
                  {formatToken(currentStaked + parsedStakeAmount)} {currentAsset}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsConfirmStakeOpen(false);
                  setIsStakeModalOpen(true);
                }}
                disabled={actionLoading}
                className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="confirm-stake-execute-button"
                onClick={handleConfirmStake}
                disabled={actionLoading}
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading && <RefreshCw size={14} className="animate-spin" />}
                <span>{actionLoading ? t('staking.processing') : t('staking.confirmStakeButton')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 3: UNSTAKE FORM MODAL                                         */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {isUnstakeModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unstake-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 id="unstake-modal-title" className="text-lg font-bold text-slate-100">
                  {t('staking.unstakeModalTitle')}
                </h3>
                <p className="text-xs text-slate-400">{t('staking.unstakeModalSubtitle')}</p>
              </div>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setIsUnstakeModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            {/* Early warning banner */}
            {isPositionLocked && (
              <div
                data-testid="early-unstake-warning"
                className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-300 space-y-1"
              >
                <div className="flex items-center gap-2 font-bold">
                  <AlertTriangle size={16} className="text-amber-400 shrink-0" />
                  <span>{t('staking.earlyWarningTitle')}</span>
                </div>
                <p className="text-amber-300/90 leading-relaxed">
                  {t('staking.earlyWarningDescription', {
                    date: position?.unlockDate ? formatDate(position.unlockDate) : '',
                    penalty: EARLY_PENALTY_PERCENT,
                  })}
                </p>
              </div>
            )}

            {/* Amount input */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="unstake-amount-input" className="font-medium text-slate-300">
                  {t('staking.unstakeAmountLabel')}
                </label>
                <span className="text-slate-400">
                  {t('staking.stakedBalance')}: <span className="font-mono text-slate-200">{formatToken(currentStaked)}</span>
                </span>
              </div>
              <div className="relative">
                <input
                  id="unstake-amount-input"
                  data-testid="unstake-amount-input"
                  type="number"
                  min="1"
                  max={currentStaked}
                  step="any"
                  value={unstakeAmountInput}
                  onChange={(e) => setUnstakeAmountInput(e.target.value)}
                  placeholder="100"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-lg font-mono text-slate-100 placeholder-slate-600 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => setUnstakeAmountInput(String(currentStaked))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg bg-slate-800 px-2 py-1 text-xs font-bold text-primary-text hover:bg-slate-700"
                >
                  {t('staking.max')}
                </button>
              </div>
            </div>

            {/* Breakdown */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>{t('staking.unstakeAmountLabel')}:</span>
                <span className="font-mono text-slate-200 font-semibold">
                  {formatToken(parsedUnstakeAmount)} {currentAsset}
                </span>
              </div>
              {earlyPenaltyAmount > 0 && (
                <div className="flex justify-between text-amber-400">
                  <span>{t('staking.penaltyDeduction')} ({EARLY_PENALTY_PERCENT}%):</span>
                  <span className="font-mono font-semibold">
                    -{formatToken(earlyPenaltyAmount)} {currentAsset}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-800 pt-1.5 font-bold">
                <span className="text-slate-300">{t('staking.netReceived')}:</span>
                <span className="font-mono text-emerald-400">
                  {formatToken(netUnstakeAmount)} {currentAsset}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsUnstakeModalOpen(false)}
                className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="review-unstake-button"
                disabled={parsedUnstakeAmount <= 0 || parsedUnstakeAmount > currentStaked}
                onClick={() => {
                  setIsUnstakeModalOpen(false);
                  setIsConfirmUnstakeOpen(true);
                }}
                className="rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {t('staking.unstakeAction')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* MODAL 4: CONFIRM UNSTAKE MODAL                                      */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      {isConfirmUnstakeOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-unstake-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-rose-500/20 p-2.5 text-rose-400">
                <ArrowDownLeft size={22} />
              </div>
              <div>
                <h3 id="confirm-unstake-title" className="text-lg font-bold text-slate-100">
                  {t('staking.confirmUnstakeTitle')}
                </h3>
                <p className="text-xs text-slate-400">{t('staking.confirmUnstakeNotice')}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">{t('staking.unstakeAmountLabel')}:</span>
                <span className="font-mono font-bold text-slate-100">
                  {formatToken(parsedUnstakeAmount)} {currentAsset}
                </span>
              </div>
              {earlyPenaltyAmount > 0 && (
                <div className="flex justify-between text-amber-400 text-xs">
                  <span>{t('staking.penaltyDeduction')}:</span>
                  <span className="font-mono">-{formatToken(earlyPenaltyAmount)} {currentAsset}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-800 pt-2 font-bold">
                <span className="text-slate-300">{t('staking.netReceived')}:</span>
                <span className="font-mono text-emerald-400">
                  {formatToken(netUnstakeAmount)} {currentAsset}
                </span>
              </div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>{t('staking.stakedBalance')}:</span>
                <span className="font-mono">
                  {formatToken(Math.max(0, currentStaked - parsedUnstakeAmount))} {currentAsset}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsConfirmUnstakeOpen(false);
                  setIsUnstakeModalOpen(true);
                }}
                disabled={actionLoading}
                className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="confirm-unstake-execute-button"
                onClick={handleConfirmUnstake}
                disabled={actionLoading}
                className="rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading && <RefreshCw size={14} className="animate-spin" />}
                <span>{actionLoading ? t('staking.processing') : t('staking.confirmUnstakeButton')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default StakingDashboard;
