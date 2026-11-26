import { useCallback, useEffect, useRef, useState } from 'react';

/** Default inactivity window: 15 minutes. */
export const DEFAULT_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

/** Events that count as the user being present. */
export const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'click',
  'scroll',
  'touchstart',
  'wheel',
] as const;

export interface InactivityTimeoutOptions {
  /**
   * How long before the timeout a warning phase begins. While warning, ambient
   * activity (mouse movement, scrolling) no longer resets the timer, so the
   * warning cannot vanish from under the user's cursor; only `reset()` — e.g.
   * a "Stay Logged In" button — extends the session.
   */
  warningMs?: number;
  /** Fired once when the warning phase begins. */
  onWarning?: () => void;
  /** When false, no timers run and no listeners are attached. Default true. */
  enabled?: boolean;
}

export interface InactivityTimeoutState {
  /** True during the warning phase that precedes the timeout. */
  isWarning: boolean;
  /** Milliseconds until timeout while warning; null otherwise. */
  remainingMs: number | null;
  /** Restarts the full inactivity window, also leaving the warning phase. */
  reset: () => void;
}

/** A null, non-positive or infinite timeout means "Never". */
const isActiveTimeout = (timeoutMs: number | null | undefined): timeoutMs is number =>
  typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0;

/**
 * Fires `onTimeout` after a period without mouse, touch, keyboard or scroll
 * activity, optionally preceded by a warning phase.
 *
 * Expiry is tracked against a wall-clock deadline as well as a timer: browsers
 * throttle timers in background tabs, so when the tab becomes visible again an
 * overdue session is expired immediately instead of whenever the throttled
 * timer finally runs.
 *
 * @param timeoutMs - Inactivity window. `null`/`0`/`Infinity` disables it ("Never").
 * @param onTimeout - Called once when the window elapses.
 *
 * @example
 * ```tsx
 * const { isWarning, remainingMs, reset } = useInactivityTimeout(15 * 60_000, lock, {
 *   warningMs: 60_000,
 *   enabled: walletConnected,
 * });
 * ```
 */
export function useInactivityTimeout(
  timeoutMs: number | null = DEFAULT_INACTIVITY_TIMEOUT_MS,
  onTimeout: () => void,
  options: InactivityTimeoutOptions = {},
): InactivityTimeoutState {
  const { warningMs = 0, onWarning, enabled = true } = options;
  const active = enabled && isActiveTimeout(timeoutMs);

  const [isWarning, setIsWarning] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const warningActiveRef = useRef(false);

  // Keep the callbacks in refs to avoid stale closures without re-arming timers.
  const onTimeoutRef = useRef(onTimeout);
  const onWarningRef = useRef(onWarning);
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
    onWarningRef.current = onWarning;
  }, [onTimeout, onWarning]);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    timeoutRef.current = null;
    warningRef.current = null;
    tickRef.current = null;
  }, []);

  const leaveWarning = useCallback(() => {
    warningActiveRef.current = false;
    setIsWarning(false);
    setRemainingMs(null);
  }, []);

  const expire = useCallback(() => {
    clearTimers();
    deadlineRef.current = null;
    leaveWarning();
    onTimeoutRef.current();
  }, [clearTimers, leaveWarning]);

  const startWarning = useCallback(() => {
    const deadline = deadlineRef.current;
    if (deadline === null) return;

    warningActiveRef.current = true;
    setIsWarning(true);
    setRemainingMs(Math.max(0, deadline - Date.now()));
    onWarningRef.current?.();

    tickRef.current = setInterval(() => {
      setRemainingMs(Math.max(0, deadline - Date.now()));
    }, 1000);
  }, []);

  /** Clears the existing timers and starts a fresh inactivity window. */
  const reset = useCallback(() => {
    clearTimers();
    leaveWarning();

    if (!active) {
      deadlineRef.current = null;
      return;
    }

    deadlineRef.current = Date.now() + timeoutMs;

    const lead = Math.min(Math.max(warningMs, 0), timeoutMs);
    if (lead > 0) {
      warningRef.current = setTimeout(startWarning, timeoutMs - lead);
    }
    timeoutRef.current = setTimeout(expire, timeoutMs);
  }, [active, timeoutMs, warningMs, clearTimers, leaveWarning, startWarning, expire]);

  useEffect(() => {
    if (!active) {
      clearTimers();
      deadlineRef.current = null;
      leaveWarning();
      return;
    }

    const handleActivity = () => {
      if (warningActiveRef.current) return;
      reset();
    };

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const deadline = deadlineRef.current;
      if (deadline !== null && Date.now() >= deadline) {
        expire();
      }
    };

    ACTIVITY_EVENTS.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });
    document.addEventListener('visibilitychange', handleVisibility);

    reset();

    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimers();
    };
  }, [active, reset, expire, clearTimers, leaveWarning]);

  return { isWarning, remainingMs, reset };
}

export default useInactivityTimeout;
