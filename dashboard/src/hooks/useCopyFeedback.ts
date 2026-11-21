import { useCallback, useEffect, useState } from 'react';

/** How long the "Copied!" confirmation stays on screen. */
export const COPY_FEEDBACK_MS = 2000;

export type CopyFeedbackState = 'idle' | 'copied' | 'failed';

/**
 * Shared clipboard state for copy affordances: writes the value, exposes a
 * transient copied/failed state, and resets back to idle after two seconds.
 */
export function useCopyFeedback() {
  const [state, setState] = useState<CopyFeedbackState>('idle');

  useEffect(() => {
    if (state === 'idle') return undefined;

    const timeoutId = window.setTimeout(() => setState('idle'), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timeoutId);
  }, [state]);

  const copy = useCallback(async (value: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
      return true;
    } catch {
      setState('failed');
      return false;
    }
  }, []);

  return { state, copy };
}

export default useCopyFeedback;
