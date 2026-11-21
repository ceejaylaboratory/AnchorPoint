/**
 * Guards wallet prompts (connect and sign) against hanging forever.
 *
 * Wallet extensions resolve their promises only when the user acts. If the
 * popup is closed, a hardware device is unplugged or the extension is
 * disabled mid-prompt, many of them never settle at all, leaving the UI stuck
 * on a spinner. `withSigningGuard` races the wallet promise against:
 *   - a timeout (90s by default),
 *   - an AbortSignal (the user pressing Cancel in our UI), and
 *   - session watchers (wallet disconnected, account switched),
 * and normalises every failure into a `WalletSigningError` with a code the UI
 * can map to a message and a retry action.
 */

export type WalletSigningErrorCode =
  | 'timeout'
  | 'cancelled'
  | 'disconnected'
  | 'account_changed'
  | 'failed';

export const SIGNING_TIMEOUT_MS = 90_000;

export class WalletSigningError extends Error {
  readonly code: WalletSigningErrorCode;

  constructor(code: WalletSigningErrorCode, message = signingErrorMessage(code), options?: { cause?: unknown }) {
    super(message);
    this.name = 'WalletSigningError';
    this.code = code;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function signingErrorMessage(code: WalletSigningErrorCode): string {
  switch (code) {
    case 'timeout':
      return 'The wallet did not respond within 90 seconds. Check that the wallet window is open and unlocked, then try again.';
    case 'cancelled':
      return 'The request was cancelled in your wallet. Nothing was signed.';
    case 'disconnected':
      return 'Your wallet disconnected before the request finished. Reconnect it and try again.';
    case 'account_changed':
      return 'The active wallet account changed during signing. Nothing was signed; review the account and try again.';
    default:
      return 'The wallet could not complete the request.';
  }
}

const CANCEL_PATTERN = /(user (declined|rejected|denied|cancel)|rejected by (the )?user|request (was )?(rejected|denied|cancel)|cancel(l)?ed|declined|denied|closed the (popup|window))/i;
const DISCONNECT_PATTERN = /(not connected|disconnected|extension (was )?(removed|disabled)|device (was )?(unplugged|disconnected|locked))/i;

/** Maps an arbitrary wallet error to a guard error. */
export function toWalletSigningError(error: unknown): WalletSigningError {
  if (error instanceof WalletSigningError) return error;

  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : typeof (error as { message?: unknown })?.message === 'string'
          ? String((error as { message: string }).message)
          : '';

  // Freighter reports a user decline as error code -4.
  const code = (error as { code?: unknown } | null)?.code;
  if (code === -4 || CANCEL_PATTERN.test(raw)) {
    return new WalletSigningError('cancelled', undefined, { cause: error });
  }
  if (DISCONNECT_PATTERN.test(raw)) {
    return new WalletSigningError('disconnected', undefined, { cause: error });
  }
  return new WalletSigningError('failed', raw || signingErrorMessage('failed'), { cause: error });
}

/** Aborts an in-flight prompt; returns a function that stops watching. */
export type SigningWatcher = (abort: (code: WalletSigningErrorCode) => void) => () => void;

export interface SigningGuardOptions {
  timeoutMs?: number;
  /** Abort from our own UI (e.g. a Cancel button). */
  signal?: AbortSignal;
  watchers?: SigningWatcher[];
}

export function withSigningGuard<T>(
  operation: () => Promise<T>,
  { timeoutMs = SIGNING_TIMEOUT_MS, signal, watchers = [] }: SigningGuardOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanups: (() => void)[] = [];

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanups.forEach((cleanup) => {
        try {
          cleanup();
        } catch {
          // A failing watcher teardown must not mask the real outcome.
        }
      });
      fn();
    };

    const abort = (code: WalletSigningErrorCode) =>
      finish(() => reject(new WalletSigningError(code)));

    if (signal?.aborted) {
      abort('cancelled');
      return;
    }

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      const timer = setTimeout(() => abort('timeout'), timeoutMs);
      cleanups.push(() => clearTimeout(timer));
    }

    if (signal) {
      const onAbort = () => abort('cancelled');
      signal.addEventListener('abort', onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener('abort', onAbort));
    }

    watchers.forEach((watch) => {
      cleanups.push(watch(abort));
    });

    let pending: Promise<T>;
    try {
      pending = Promise.resolve(operation());
    } catch (error) {
      finish(() => reject(toWalletSigningError(error)));
      return;
    }

    pending.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(toWalletSigningError(error))),
    );
  });
}

/** Window events wallets (or our adapters) emit when the session ends. */
export const WALLET_DISCONNECT_EVENTS = ['freighter:disconnect', 'wallet:disconnect'] as const;
export const WALLET_ACCOUNT_CHANGE_EVENTS = ['freighter:accountChanged', 'wallet:accountChanged'] as const;

/**
 * Aborts on wallet disconnect / account-change window events. An account
 * event carrying the same public key as `expectedPublicKey` is ignored.
 */
export const windowEventWatcher =
  (expectedPublicKey?: string | null): SigningWatcher =>
  (abort) => {
    const onDisconnect = () => abort('disconnected');
    const onAccount = (event: Event) => {
      const next = (event as CustomEvent<{ publicKey?: string; address?: string } | undefined>).detail;
      const key = next?.publicKey ?? next?.address;
      if (expectedPublicKey && key && key === expectedPublicKey) return;
      abort('account_changed');
    };

    WALLET_DISCONNECT_EVENTS.forEach((name) => window.addEventListener(name, onDisconnect));
    WALLET_ACCOUNT_CHANGE_EVENTS.forEach((name) => window.addEventListener(name, onAccount));
    return () => {
      WALLET_DISCONNECT_EVENTS.forEach((name) => window.removeEventListener(name, onDisconnect));
      WALLET_ACCOUNT_CHANGE_EVENTS.forEach((name) => window.removeEventListener(name, onAccount));
    };
  };

/** Store-like source of the connected public key (e.g. the zustand wallet store). */
export interface PublicKeySource {
  getState: () => { publicKey: string | null };
  subscribe: (listener: (state: { publicKey: string | null }) => void) => () => void;
}

/** Aborts when the connected key in `store` is cleared or replaced. */
export const storeWatcher =
  (store: PublicKeySource): SigningWatcher =>
  (abort) => {
    const initial = store.getState().publicKey;
    return store.subscribe((state) => {
      if (state.publicKey === initial) return;
      abort(state.publicKey ? 'account_changed' : 'disconnected');
    });
  };

/** Freighter's polling watcher, typed narrowly so tests can supply a fake. */
export interface FreighterChangeWatcher {
  watch: (cb: (params: { address: string; error?: unknown }) => void) => unknown;
  stop: () => void;
}

/**
 * Polls Freighter for account changes while a prompt is open. The first
 * callback reports the current state and establishes the baseline.
 */
export const freighterWatcher =
  (create: () => FreighterChangeWatcher, expectedPublicKey?: string | null): SigningWatcher =>
  (abort) => {
    let watcher: FreighterChangeWatcher | null = null;
    try {
      watcher = create();
    } catch {
      return () => {};
    }
    let baseline: string | null = expectedPublicKey ?? null;
    watcher.watch(({ address, error }) => {
      if (error || !address) {
        abort('disconnected');
        return;
      }
      if (baseline === null) {
        baseline = address;
        return;
      }
      if (address !== baseline) abort('account_changed');
    });
    return () => watcher?.stop();
  };
