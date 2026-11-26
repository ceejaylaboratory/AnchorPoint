import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOLOCK_STORAGE_KEY,
  DEFAULT_AUTOLOCK,
  autoLockToMs,
  getSessionSecret,
  hasSessionSecrets,
  onSessionSecretsWiped,
  parseAutoLock,
  readAutoLock,
  setSessionSecret,
  useAutoLockSetting,
  wipeSessionSecrets,
} from './sessionLock';

beforeEach(() => {
  localStorage.clear();
  wipeSessionSecrets();
});

describe('auto-lock setting', () => {
  it('defaults to 15 minutes and rejects unknown values', () => {
    expect(readAutoLock()).toBe(DEFAULT_AUTOLOCK);
    expect(parseAutoLock('7')).toBe(15);
    expect(parseAutoLock('never')).toBe('never');
    expect(parseAutoLock('30')).toBe(30);
  });

  it('converts settings to milliseconds, with Never as null', () => {
    expect(autoLockToMs(5)).toBe(300_000);
    expect(autoLockToMs('never')).toBeNull();
  });

  it('persists changes and notifies every subscriber', () => {
    const a = renderHook(() => useAutoLockSetting());
    const b = renderHook(() => useAutoLockSetting());

    act(() => a.result.current[1](5));

    expect(localStorage.getItem(AUTOLOCK_STORAGE_KEY)).toBe('5');
    expect(b.result.current[0]).toBe(5);
  });

  it('uses a storage key the sign-out sweep does not clear', () => {
    expect(/token|session|wallet|transaction|balance/i.test(AUTOLOCK_STORAGE_KEY)).toBe(false);
  });
});

describe('session secret vault', () => {
  it('zero-fills binary secrets and clears the vault on wipe', () => {
    const key = new Uint8Array([1, 2, 3, 4]);
    setSessionSecret('signing-key', key);
    setSessionSecret('token', 'abc');
    expect(hasSessionSecrets()).toBe(true);

    wipeSessionSecrets();

    expect(Array.from(key)).toEqual([0, 0, 0, 0]);
    expect(getSessionSecret('signing-key')).toBeUndefined();
    expect(getSessionSecret('token')).toBeUndefined();
    expect(hasSessionSecrets()).toBe(false);
  });

  it('scrubs a replaced binary secret', () => {
    const first = new Uint8Array([9, 9]);
    setSessionSecret('k', first);
    setSessionSecret('k', new Uint8Array([1]));
    expect(Array.from(first)).toEqual([0, 0]);
  });

  it('notifies wipe listeners, isolating failures', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = onSessionSecretsWiped(() => {
      throw new Error('boom');
    });
    const listener = vi.fn();
    const off = onSessionSecretsWiped(listener);

    wipeSessionSecrets();
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    bad();
    wipeSessionSecrets();
    expect(listener).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
