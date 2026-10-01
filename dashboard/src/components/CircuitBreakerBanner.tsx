import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertOctagon, Loader2, RefreshCw } from 'lucide-react';
import { Account, Contract, TransactionBuilder, rpc } from '@stellar/stellar-sdk';

export interface CircuitBreakerBannerProps {
  /** The deployed `src/circuit_breaker` contract id. */
  contractId: string;
  /** Soroban RPC endpoint the status is polled from. */
  rpcUrl: string;
  /** Network passphrase for the simulated read calls. */
  networkPassphrase?: string;
  /** How often the contract is re-read, in ms. */
  pollIntervalMs?: number;
}

export type CircuitBreakerState = 'loading' | 'clear' | 'paused' | 'unavailable';

export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  /** Pause tier reported by the contract (`swap`, `withdraw`, `all`, …). */
  tier: string | null;
  /** Unix timestamp the unpause timelock unlocks at, or null when unknown. */
  unlockTime: number | null;
  /** Seconds left on the cool-off, recomputed every second. */
  secondsRemaining: number | null;
  /** Populated for the `unavailable` state. */
  error: string | null;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;

/** Placeholder account used only to build read-only simulation transactions. */
const READ_ACCOUNT = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0');

/** Runs one read-only simulated invocation and returns its native value. */
async function readContractValue(
  server: rpc.Server,
  contractId: string,
  functionName: string,
  networkPassphrase: string,
): Promise<unknown> {
  const contract = new Contract(contractId);
  const transaction = new TransactionBuilder(READ_ACCOUNT, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(contract.call(functionName))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Simulation failed while reading ${functionName}()`);
  }

  const raw = (simulation as { result?: { retval?: unknown } }).result?.retval;
  return raw ?? null;
}

/** Coerces a simulated ScVal (or its native form) into a number. */
function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    return toNumber((value as Record<string, unknown>).value);
  }
  return 0;
}

/** Coerces a simulated ScVal into a display string (enums arrive as symbols). */
function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.sym === 'string') return record.sym;
    if ('value' in record) return toText(record.value);
  }
  return null;
}

/**
 * Polls the circuit breaker contract for its pause state.
 *
 * `is_paused()` decides whether the banner is shown at all; when paused,
 * `get_pause_tier()` names the scope and `get_unpause_unlock_time()` is the
 * unix timestamp the unpause timelock opens, which drives the live cool-off
 * countdown. A failed poll surfaces as `unavailable` rather than silently
 * reporting the protocol as clear — a stale "all clear" is the dangerous
 * direction to be wrong in.
 */
export function pollCircuitBreakerStatus(
  options: {
    contractId: string;
    rpcUrl: string;
    networkPassphrase: string;
    now?: number;
  },
): Promise<CircuitBreakerStatus> {
  const { contractId, rpcUrl, networkPassphrase } = options;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });

  return (async (): Promise<CircuitBreakerStatus> => {
    try {
      const paused = toNumber(
        await readContractValue(server, contractId, 'is_paused', networkPassphrase),
      );

      if (paused === 0) {
        return { state: 'clear', tier: null, unlockTime: null, secondsRemaining: null, error: null };
      }

      const [tier, unlockTime] = await Promise.all([
        readContractValue(server, contractId, 'get_pause_tier', networkPassphrase),
        readContractValue(server, contractId, 'get_unpause_unlock_time', networkPassphrase),
      ]);

      const unlock = toNumber(unlockTime);
      const hasUnlock = Number.isFinite(unlock) && unlock > 0;

      return {
        state: 'paused',
        tier: toText(tier),
        unlockTime: hasUnlock ? unlock : null,
        secondsRemaining: hasUnlock ? Math.max(0, unlock - now) : null,
        error: null,
      };
    } catch (err) {
      return {
        state: 'unavailable',
        tier: null,
        unlockTime: null,
        secondsRemaining: null,
        error: err instanceof Error ? err.message : 'Failed to read circuit breaker status',
      };
    }
  })();
}

/** `m:ss` / `h:mm:ss` formatting for the cool-off countdown. */
export function formatCooldown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const CircuitBreakerBanner: React.FC<CircuitBreakerBannerProps> = ({
  contractId,
  rpcUrl,
  networkPassphrase = 'Test SDF Network ; September 2015',
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}) => {
  const [status, setStatus] = useState<CircuitBreakerStatus>({
    state: 'loading',
    tier: null,
    unlockTime: null,
    secondsRemaining: null,
    error: null,
  });
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const next = await pollCircuitBreakerStatus({
      contractId,
      rpcUrl,
      networkPassphrase,
    });
    if (mounted.current) {
      setStatus(next);
      setNow(Math.floor(Date.now() / 1000));
    }
  }, [contractId, rpcUrl, networkPassphrase]);

  // Initial read plus the polling interval.
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, pollIntervalMs);

    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, [refresh, pollIntervalMs]);

  // Ticks once a second so the countdown advances between polls.
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => clearInterval(tick);
  }, []);

  // Renders nothing while loading and while the protocol is clear.
  if (status.state === 'loading' || status.state === 'clear') {
    return null;
  }

  if (status.state === 'unavailable') {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
      >
        <AlertOctagon size={14} className="shrink-0" aria-hidden="true" />
        <span>
          Circuit breaker status unavailable{status.error ? `: ${status.error}` : ''} — pause state
          is unverified.
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto inline-flex items-center gap-1 rounded border border-amber-500/40 px-2 py-1 font-medium hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
        >
          <RefreshCw size={12} aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  const secondsRemaining =
    status.unlockTime === null
      ? null
      : Math.max(0, status.unlockTime - now);

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
    >
      <AlertOctagon size={16} className="shrink-0" aria-hidden="true" />
      <span className="font-semibold">
        Protocol paused{status.tier ? ` (${status.tier})` : ''}
      </span>
      <span className="text-xs text-red-200/80">
        Swaps and withdrawals are temporarily disabled.
      </span>
      {secondsRemaining !== null ? (
        <span className="ml-auto flex items-center gap-1 font-mono text-xs" role="timer">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          Cool-off {formatCooldown(secondsRemaining)}
        </span>
      ) : (
        <span className="ml-auto text-xs text-red-200/80">Cool-off pending</span>
      )}
    </div>
  );
};

export default CircuitBreakerBanner;
