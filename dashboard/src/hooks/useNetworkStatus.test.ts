import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNetworkStatus } from './useNetworkStatus';

describe('useNetworkStatus', () => {
  let onlineGetter: jest.SpyInstance;

  beforeEach(() => {
    // Default to online so each test starts from a known state.
    onlineGetter = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    onlineGetter.mockRestore();
  });

  it('reports online when navigator.onLine is true at mount', () => {
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);
  });

  it('reports offline when navigator.onLine is false at mount', () => {
    onlineGetter.mockReturnValue(false);
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(false);
  });

  it('switches to offline when the browser fires the offline event', () => {
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.isOnline).toBe(false);
  });

  it('switches back to online when the browser fires the online event', () => {
    onlineGetter.mockReturnValue(false);
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.isOnline).toBe(true);
  });

  it('removes event listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useNetworkStatus());
    unmount();

    const addedOnline = addSpy.mock.calls.some(([e]) => e === 'online');
    const addedOffline = addSpy.mock.calls.some(([e]) => e === 'offline');
    const removedOnline = removeSpy.mock.calls.some(([e]) => e === 'online');
    const removedOffline = removeSpy.mock.calls.some(([e]) => e === 'offline');

    expect(addedOnline).toBe(true);
    expect(addedOffline).toBe(true);
    expect(removedOnline).toBe(true);
    expect(removedOffline).toBe(true);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
