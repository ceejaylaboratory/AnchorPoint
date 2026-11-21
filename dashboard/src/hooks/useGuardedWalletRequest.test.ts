import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGuardedWalletRequest } from './useGuardedWalletRequest';

describe('useGuardedWalletRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves the pending state with a timeout error instead of spinning forever', async () => {
    const { result } = renderHook(() => useGuardedWalletRequest<string>());

    let outcome: Promise<string | undefined> = Promise.resolve(undefined);
    act(() => {
      outcome = result.current.run(() => new Promise<string>(() => {}));
    });
    expect(result.current.status).toBe('pending');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });

    await expect(outcome).resolves.toBeUndefined();
    expect(result.current.status).toBe('error');
    expect(result.current.error?.code).toBe('timeout');
  });

  it('retries the last operation without a reload', async () => {
    const sign = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('User rejected the request'))
      .mockResolvedValueOnce('SIGNED');
    const { result } = renderHook(() => useGuardedWalletRequest<string>());

    await act(async () => {
      await result.current.run(sign);
    });
    expect(result.current.error?.code).toBe('cancelled');

    let retried: string | undefined;
    await act(async () => {
      retried = await result.current.retry();
    });
    expect(retried).toBe('SIGNED');
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it('cancel() returns to idle without an error', async () => {
    const { result } = renderHook(() => useGuardedWalletRequest<string>());
    let outcome: Promise<string | undefined> = Promise.resolve(undefined);
    act(() => {
      outcome = result.current.run(() => new Promise<string>(() => {}));
    });

    act(() => result.current.cancel());

    await expect(outcome).resolves.toBeUndefined();
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });
});
