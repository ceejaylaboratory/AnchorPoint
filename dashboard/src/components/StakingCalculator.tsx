import { useMemo, useState } from 'react';
import { Calculator, LockKeyhole, TrendingUp } from 'lucide-react';

export const LOCK_DURATION_OPTIONS = [30, 90, 365] as const;
export type LockDurationDays = (typeof LOCK_DURATION_OPTIONS)[number];

const BASE_APY = 4.8;
const LOCK_MULTIPLIERS: Record<LockDurationDays, number> = {
  30: 1,
  90: 1.35,
  365: 2.1,
};

export function calculateEstimatedApy(lockDurationDays: LockDurationDays): number {
  return Number((BASE_APY * LOCK_MULTIPLIERS[lockDurationDays]).toFixed(2));
}

export function calculateProjectedRewards(
  depositAmount: number,
  lockDurationDays: LockDurationDays,
): number {
  const apy = calculateEstimatedApy(lockDurationDays) / 100;
  return Number((depositAmount * apy * (lockDurationDays / 365)).toFixed(2));
}

const formatTokenAmount = (amount: number) =>
  amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const StakingCalculator = () => {
  const [depositAmount, setDepositAmount] = useState(2_500);
  const [lockDuration, setLockDuration] = useState<LockDurationDays>(90);

  const estimatedApy = calculateEstimatedApy(lockDuration);
  const projectedRewards = useMemo(
    () => calculateProjectedRewards(depositAmount, lockDuration),
    [depositAmount, lockDuration],
  );
  const projectedBalance = depositAmount + projectedRewards;

  return (
    <section aria-labelledby="staking-calculator-title" className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3
            id="staking-calculator-title"
            className="font-display text-xl font-bold text-slate-100"
          >
            Staking yield estimator
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            Estimate rewards by deposit size and lock period.
          </p>
        </div>
        <div className="rounded-lg border border-primary/30 bg-primary/10 p-2 text-primary-text">
          <Calculator size={20} aria-hidden="true" />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="staking-deposit-amount" className="text-sm font-medium text-slate-300">
            Deposit amount
          </label>
          <output
            htmlFor="staking-deposit-amount"
            aria-label="Selected deposit amount"
            className="font-mono text-sm text-slate-100"
          >
            {formatTokenAmount(depositAmount)} APX
          </output>
        </div>
        <input
          id="staking-deposit-amount"
          type="range"
          min={100}
          max={100_000}
          step={100}
          value={depositAmount}
          onChange={(event) => setDepositAmount(Number(event.target.value))}
          className="w-full accent-[var(--primary)]"
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <LockKeyhole size={16} aria-hidden="true" />
          Lock duration
        </div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Lock duration">
          {LOCK_DURATION_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              role="radio"
              aria-checked={lockDuration === days}
              onClick={() => setLockDuration(days)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text ${
                lockDuration === days
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-slate-700 bg-slate-950/50 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Est. APY</p>
          <p className="mt-2 font-mono text-lg font-semibold text-emerald-300">
            {estimatedApy.toFixed(2)}%
          </p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Rewards</p>
          <p className="mt-2 font-mono text-lg font-semibold text-slate-100">
            {formatTokenAmount(projectedRewards)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Projected</p>
          <p className="mt-2 font-mono text-lg font-semibold text-slate-100">
            {formatTokenAmount(projectedBalance)}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
        <TrendingUp size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <p>
          Longer lock periods apply a higher APY multiplier while prorating rewards to the
          selected duration.
        </p>
      </div>
    </section>
  );
};

export default StakingCalculator;
