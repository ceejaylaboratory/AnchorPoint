import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WalletSigningError,
  toWalletSigningError,
  withSigningGuard,
  type SigningGuardOptions,
} from '../lib/wallet/signingGuard';

export type GuardedRequestStatus = 'idle' | 'pending' | 'error';

export interface GuardedWalletRequest<T> {
  status: GuardedRequestStatus;
  error: WalletSigningError | null;
  /**
   * Runs a wallet prompt under the signing guard. Resolves to the wallet's
   * result, or `undefined` when the prompt failed, timed out or was cancelled
   * (the failure is exposed via `error`). Never rejects.
   */
  run: (operation: () => Promise<T>, options?: Omit<SigningGuardOptions, 'signal'>) => Promise<T | undefined>;
  /** Re-runs the last operation with the same options. */
  retry: () => Promise<T | undefined>;
  /** Abandons the in-flight prompt and returns to idle without an error. */
  cancel: () => void;
  /** Clears any error. */
  reset: () => void;
}

/**
 * UI state for one wallet prompt at a time: no indefinite spinners, a clear
 * error on timeout / cancellation / disconnect, and a retry that needs no
 * page reload.
 */
export function useGuardedWalletRequest<T>(): GuardedWalletRequest<T> {
  const [status, setStatus] = useState<GuardedRequestStatus>('idle');
  const [error, setError] = useState<WalletSigningError | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const lastRef = useRef<{ operation: () => Promise<T>; options?: Omit<SigningGuardOptions, 'signal'> } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const run = useCallback(
    async (operation: () => Promise<T>, options?: Omit<SigningGuardOptions, 'signal'>) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      lastRef.current = { operation, options };

      setError(null);
      setStatus('pending');

      try {
        const result = await withSigningGuard(operation, { ...options, signal: controller.signal });
        if (mountedRef.current && controllerRef.current === controller) {
          controllerRef.current = null;
          setStatus('idle');
        }
        return result;
      } catch (err) {
        // A superseded or locally cancelled request must not overwrite newer state.
        if (!mountedRef.current || controllerRef.current !== controller) return undefined;
        controllerRef.current = null;
        setError(toWalletSigningError(err));
        setStatus('error');
        return undefined;
      }
    },
    [],
  );

  const retry = useCallback(async () => {
    const last = lastRef.current;
    if (!last) return undefined;
    return run(last.operation, last.options);
  }, [run]);

  const cancel = useCallback(() => {
    const controller = controllerRef.current;
    controllerRef.current = null;
    controller?.abort();
    setError(null);
    setStatus('idle');
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setStatus((current) => (current === 'error' ? 'idle' : current));
  }, []);

  return { status, error, run, retry, cancel, reset };
}

export default useGuardedWalletRequest;
