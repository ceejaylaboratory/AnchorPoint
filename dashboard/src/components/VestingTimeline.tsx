import { useEffect, useState } from 'react';
import { CalendarClock, Lock, Unlock } from 'lucide-react';

export type VestingSchedule = {
  id: string;
  /** Token symbol shown next to amounts, e.g. "ANCHOR". */
  tokenSymbol: string;
  /** Total tokens granted by the schedule. */
  totalAmount: number;
  /** Tokens already claimed by the beneficiary. */
  claimedAmount: number;
  /** Epoch ms vesting starts accruing. */
  startTime: number;
  /** Epoch ms of the cliff; nothing is claimable before it. */
  cliffTime: number;
  /** Epoch ms the schedule is fully vested. */
  endTime: number;
  /**
   * Step size in ms for periodic unlocks (e.g. monthly). Omit for continuous
   * linear vesting.
   */
  unlockIntervalMs?: number;
};

export type VestingProgress = {
  vestedAmount: number;
  lockedAmount: number;
  claimableAmount: number;
  /** 0–100, rounded to 2 decimals. */
  vestedPercent: number;
  /** 0–100, always 100 - vestedPercent. */
  lockedPercent: number;
  /** Position of `now` on the start→end track, 0–100. */
  elapsedPercent: number;
  /** Position of the cliff on the start→end track, 0–100. */
  cliffPercent: number;
  /** Next moment more tokens become claimable; null once fully vested or for continuous vesting past the cliff. */
  nextUnlockTime: number | null;
  phase: 'before-cliff' | 'vesting' | 'fully-vested';
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Linear vesting from startTime to endTime gated by a cliff: before the cliff
 * nothing is vested; at the cliff the amount accrued since start unlocks at
 * once. With `unlockIntervalMs`, accrual advances in whole steps from startTime.
 */
export const computeVestingProgress = (schedule: VestingSchedule, now: number): VestingProgress => {
  const { totalAmount, claimedAmount, startTime, cliffTime, endTime, unlockIntervalMs } = schedule;
  const duration = Math.max(0, endTime - startTime);
  const toTrack = (t: number) => (duration === 0 ? 100 : clamp(((t - startTime) / duration) * 100, 0, 100));

  let vestedFraction: number;
  let nextUnlockTime: number | null;
  let phase: VestingProgress['phase'];

  if (now >= endTime) {
    vestedFraction = 1;
    nextUnlockTime = null;
    phase = 'fully-vested';
  } else if (now < cliffTime) {
    vestedFraction = 0;
    nextUnlockTime = cliffTime;
    phase = 'before-cliff';
  } else {
    const elapsed = now - startTime;
    if (unlockIntervalMs && unlockIntervalMs > 0) {
      const steps = Math.floor(elapsed / unlockIntervalMs);
      vestedFraction = (steps * unlockIntervalMs) / duration;
      nextUnlockTime = Math.min(startTime + (steps + 1) * unlockIntervalMs, endTime);
    } else {
      vestedFraction = elapsed / duration;
      nextUnlockTime = null;
    }
    phase = 'vesting';
  }

  vestedFraction = clamp(vestedFraction, 0, 1);
  const vestedAmount = totalAmount * vestedFraction;
  const vestedPercent = round2(vestedFraction * 100);

  return {
    vestedAmount,
    lockedAmount: totalAmount - vestedAmount,
    claimableAmount: Math.max(0, vestedAmount - claimedAmount),
    vestedPercent,
    lockedPercent: round2(100 - vestedPercent),
    elapsedPercent: toTrack(now),
    cliffPercent: toTrack(cliffTime),
    nextUnlockTime,
    phase,
  };
};

const formatAmount = (value: number, symbol: string) =>
  `${value.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${symbol}`;

const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const PHASE_LABEL: Record<VestingProgress['phase'], string> = {
  'before-cliff': 'Before cliff',
  vesting: 'Vesting',
  'fully-vested': 'Fully vested',
};

interface VestingCardProps {
  schedule: VestingSchedule;
  now: number;
  onClaim?: (scheduleId: string) => void | Promise<void>;
}

const VestingCard = ({ schedule, now, onClaim }: VestingCardProps) => {
  const [claiming, setClaiming] = useState(false);
  const progress = computeVestingProgress(schedule, now);
  const { tokenSymbol } = schedule;
  const canClaim = progress.claimableAmount > 0 && !!onClaim && !claiming;

  const handleClaim = async () => {
    if (!canClaim || !onClaim) return;
    setClaiming(true);
    try {
      await onClaim(schedule.id);
    } finally {
      setClaiming(false);
    }
  };

  const nextUnlockText =
    progress.phase === 'fully-vested'
      ? 'All tokens unlocked'
      : progress.nextUnlockTime !== null
        ? formatDate(progress.nextUnlockTime)
        : `Unlocking continuously until ${formatDate(schedule.endTime)}`;

  return (
    <article
      className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
      data-testid={`vesting-schedule-${schedule.id}`}
      aria-label={`Vesting schedule ${schedule.id}`}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-semibold text-slate-100">
            {formatAmount(schedule.totalAmount, tokenSymbol)}
          </p>
          <p className="text-xs text-slate-500">Schedule {schedule.id}</p>
        </div>
        <span className="rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300">
          {PHASE_LABEL[progress.phase]}
        </span>
      </header>

      {/* Vested vs locked split */}
      <div
        role="progressbar"
        aria-label="Vested percentage"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.vestedPercent}
        aria-valuetext={`${progress.vestedPercent}% vested, ${progress.lockedPercent}% locked`}
        className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800"
      >
        <div
          data-testid="vesting-progress-vested"
          className="h-full bg-indigo-500 transition-[width] duration-500"
          style={{ width: `${progress.vestedPercent}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs">
        <span className="flex items-center gap-1 text-slate-300">
          <Unlock className="h-3 w-3" aria-hidden="true" />
          Vested {progress.vestedPercent}% · {formatAmount(progress.vestedAmount, tokenSymbol)}
        </span>
        <span className="flex items-center gap-1 text-slate-500">
          <Lock className="h-3 w-3" aria-hidden="true" />
          Locked {progress.lockedPercent}% · {formatAmount(progress.lockedAmount, tokenSymbol)}
        </span>
      </div>

      {/* Start → cliff → end timeline with a "now" marker */}
      <div className="relative mt-5 mb-8 h-1 rounded-full bg-slate-800" data-testid="vesting-timeline-track">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-slate-600"
          style={{ width: `${progress.elapsedPercent}%` }}
        />
        {[
          { key: 'start', pct: 0, label: 'Start', time: schedule.startTime, align: 'left' },
          { key: 'cliff', pct: progress.cliffPercent, label: 'Cliff', time: schedule.cliffTime, align: 'center' },
          { key: 'end', pct: 100, label: 'End', time: schedule.endTime, align: 'right' },
        ].map((marker) => (
          <div
            key={marker.key}
            data-testid={`vesting-marker-${marker.key}`}
            className="absolute top-1/2 -translate-y-1/2"
            style={{ left: `${marker.pct}%` }}
          >
            <span className="block h-3 w-3 -translate-x-1/2 rounded-full border-2 border-slate-900 bg-slate-400" />
            <span
              className={`absolute top-4 whitespace-nowrap text-[11px] text-slate-500 ${
                marker.align === 'left' ? 'left-0 -translate-x-1.5' : marker.align === 'right' ? 'right-0 translate-x-1.5' : '-translate-x-1/2'
              }`}
            >
              {marker.label} · {new Date(marker.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
            </span>
          </div>
        ))}
        {progress.phase !== 'fully-vested' && (
          <span
            data-testid="vesting-marker-now"
            aria-hidden="true"
            className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-indigo-400"
            style={{ left: `${progress.elapsedPercent}%` }}
          />
        )}
      </div>

      <footer className="flex flex-wrap items-end justify-between gap-3 border-t border-slate-800 pt-3">
        <dl className="space-y-1 text-xs">
          <div className="flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            <dt className="text-slate-500">Next unlock:</dt>
            <dd className="text-slate-200" data-testid="vesting-next-unlock">{nextUnlockText}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-slate-500">Claimable:</dt>
            <dd className="font-mono font-semibold text-slate-100" data-testid="vesting-claimable">
              {formatAmount(progress.claimableAmount, tokenSymbol)}
            </dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={handleClaim}
          disabled={!canClaim}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          {claiming ? 'Claiming…' : 'Claim Vested Tokens'}
        </button>
      </footer>
    </article>
  );
};

interface VestingTimelineProps {
  schedules: VestingSchedule[];
  /** Called with the schedule id when the user claims; a returned promise keeps the button in its pending state. */
  onClaim?: (scheduleId: string) => void | Promise<void>;
  /** Fixed clock for deterministic rendering; when omitted the view ticks every 30s. */
  now?: number;
}

/**
 * Timeline view for active vesting schedules: cliff/end milestones, a vested vs
 * locked progress bar, the next unlock time and the currently claimable amount.
 * Schedules that are fully vested and fully claimed are hidden.
 */
export const VestingTimeline = ({ schedules, onClaim, now: fixedNow }: VestingTimelineProps) => {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (fixedNow !== undefined) return;
    const id = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [fixedNow]);

  const now = fixedNow ?? tick;
  const active = schedules.filter((s) => s.claimedAmount < s.totalAmount);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="vesting-timeline-heading">
      <h3 id="vesting-timeline-heading" className="font-display text-xl font-bold text-slate-100">
        Vesting Schedules
      </h3>
      {active.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">
          No active vesting schedules
        </p>
      ) : (
        active.map((schedule) => (
          <VestingCard key={schedule.id} schedule={schedule} now={now} onClaim={onClaim} />
        ))
      )}
    </section>
  );
};

export default VestingTimeline;
