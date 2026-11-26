import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIGNING_TIMEOUT_MS,
  WalletSigningError,
  freighterWatcher,
  storeWatcher,
  toWalletSigningError,
  windowEventWatcher,
  withSigningGuard,
  type FreighterChangeWatcher,
} from './signingGuard';

const never = <T,>() => new Promise<T>(() => {});

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toBeInstanceOf(WalletSigningError);
  await expect(promise).rejects.toMatchObject({ code });
};

describe('withSigningGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the wallet result', async () => {
    await expect(withSigningGuard(async () => 'SIGNED_XDR')).resolves.toBe('SIGNED_XDR');
  });

  it('times out a prompt that never settles after 90 seconds', async () => {
    const promise = withSigningGuard(() => never<string>());
    const assertion = expectCode(promise, 'timeout');

    await vi.advanceTimersByTimeAsync(SIGNING_TIMEOUT_MS - 1);
    let settled = false;
    promise.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('maps a user rejection to "cancelled"', async () => {
    await expectCode(
      withSigningGuard(() => Promise.reject(new Error('User declined access'))),
      'cancelled',
    );
    await expectCode(
      withSigningGuard(() => Promise.reject({ code: -4, message: 'The user rejected this request.' })),
      'cancelled',
    );
  });

  it('cancels from an AbortSignal, including one already aborted', async () => {
    const controller = new AbortController();
    const promise = withSigningGuard(() => never<string>(), { signal: controller.signal });
    controller.abort();
    await expectCode(promise, 'cancelled');

    await expectCode(withSigningGuard(() => never<string>(), { signal: controller.signal }), 'cancelled');
  });

  it('aborts when a watcher reports a disconnect and tears watchers down once', async () => {
    const stop = vi.fn();
    let trigger: (code: 'disconnected') => void = () => {};
    const promise = withSigningGuard(() => never<string>(), {
      watchers: [
        (abort) => {
          trigger = abort;
          return stop;
        },
      ],
    });

    trigger('disconnected');
    await expectCode(promise, 'disconnected');
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('ignores a late wallet response after the timeout', async () => {
    let resolveWallet: (value: string) => void = () => {};
    const promise = withSigningGuard(
      () => new Promise<string>((resolve) => {
        resolveWallet = resolve;
      }),
      { timeoutMs: 1000 },
    );
    const assertion = expectCode(promise, 'timeout');
    await vi.advanceTimersByTimeAsync(1000);
    resolveWallet('TOO_LATE');
    await assertion;
  });

  it('wraps a synchronous throw from the operation', async () => {
    await expectCode(
      withSigningGuard(() => {
        throw new Error('boom');
      }),
      'failed',
    );
  });
});

describe('toWalletSigningError', () => {
  it('keeps the wallet message for generic failures', () => {
    const error = toWalletSigningError(new Error('Rabet extension is not available.'));
    expect(error.code).toBe('failed');
    expect(error.message).toBe('Rabet extension is not available.');
  });

  it('detects disconnects and unplugged devices', () => {
    expect(toWalletSigningError(new Error('Ledger device was unplugged')).code).toBe('disconnected');
    expect(toWalletSigningError('Wallet disconnected').code).toBe('disconnected');
  });
});

describe('watchers', () => {
  it('window events abort on disconnect and on a different account only', async () => {
    const watch = windowEventWatcher('GA_ORIGINAL');
    const abort = vi.fn();
    const stop = watch(abort);

    window.dispatchEvent(new CustomEvent('wallet:accountChanged', { detail: { publicKey: 'GA_ORIGINAL' } }));
    expect(abort).not.toHaveBeenCalled();

    window.dispatchEvent(new CustomEvent('freighter:accountChanged', { detail: { address: 'GB_OTHER' } }));
    expect(abort).toHaveBeenLastCalledWith('account_changed');

    window.dispatchEvent(new Event('freighter:disconnect'));
    expect(abort).toHaveBeenLastCalledWith('disconnected');

    stop();
    abort.mockClear();
    window.dispatchEvent(new Event('freighter:disconnect'));
    expect(abort).not.toHaveBeenCalled();
  });

  it('store watcher distinguishes disconnect from account switch', () => {
    let listener: (state: { publicKey: string | null }) => void = () => {};
    const store = {
      getState: () => ({ publicKey: 'GA' }),
      subscribe: (fn: typeof listener) => {
        listener = fn;
        return () => {};
      },
    };
    const abort = vi.fn();
    storeWatcher(store)(abort);

    listener({ publicKey: 'GA' });
    expect(abort).not.toHaveBeenCalled();
    listener({ publicKey: 'GB' });
    expect(abort).toHaveBeenLastCalledWith('account_changed');
    listener({ publicKey: null });
    expect(abort).toHaveBeenLastCalledWith('disconnected');
  });

  it('freighter watcher baselines the first report, then aborts on change and stops', () => {
    let cb: (params: { address: string; error?: unknown }) => void = () => {};
    const fake: FreighterChangeWatcher = {
      watch: (fn) => {
        cb = fn;
        return {};
      },
      stop: vi.fn(),
    };
    const abort = vi.fn();
    const stop = freighterWatcher(() => fake)(abort);

    cb({ address: 'GA' });
    cb({ address: 'GA' });
    expect(abort).not.toHaveBeenCalled();
    cb({ address: 'GB' });
    expect(abort).toHaveBeenCalledWith('account_changed');
    cb({ address: '', error: { code: -1 } });
    expect(abort).toHaveBeenLastCalledWith('disconnected');

    stop();
    expect(fake.stop).toHaveBeenCalled();
  });
});
