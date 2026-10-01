import { useCallback, useEffect, useRef } from 'react';

/**
 * Custom hook that logs out users after a period of inactivity.
 * 
 * @param timeoutMs - Duration of inactivity before timeout fires (default: 15 minutes = 900000ms)
 * @param onTimeout - Callback function executed when timeout occurs
 * 
 * @example
 * ```tsx
 * const handleLogout = useCallback(() => {
 *   sessionStorage.clear();
 *   window.location.href = '/login';
 * }, []);
 * 
 * useInactivityTimeout(900000, handleLogout);
 * ```
 */
export function useInactivityTimeout(
  timeoutMs: number = 15 * 60 * 1000, // 15 minutes default
  onTimeout: () => void
): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeoutRef = useRef(onTimeout);

  // Keep the callback ref updated to avoid stale closures
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  /**
   * Clears the existing timeout and starts a new one.
   * This is called whenever user activity is detected.
   */
  const resetTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      onTimeoutRef.current();
    }, timeoutMs);
  }, [timeoutMs]);

  /**
   * Event handlers that reset the inactivity timer.
   * These cover all common user interaction patterns.
   */
  useEffect(() => {
    // User activity events that should reset the timer
    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;

    const handleActivity = () => {
      resetTimer();
    };

    // Add event listeners for all activity types
    activityEvents.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true });
    });

    // Initialize the timer when the hook mounts
    resetTimer();

    // Cleanup on unmount
    return () => {
      activityEvents.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [resetTimer]);
}

export default useInactivityTimeout;