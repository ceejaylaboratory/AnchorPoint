import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInactivityTimeout } from './useInactivityTimeout';

describe('useInactivityTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('sessionStorage', {
      clear: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('triggers onTimeout after specified duration of inactivity', () => {
    const onTimeout = vi.fn();
    const timeoutMs = 60000; // 1 minute

    renderHook(() => useInactivityTimeout(timeoutMs, onTimeout));

    // Fast-forward time without any user activity
    act(() => {
      vi.advanceTimersByTime(timeoutMs);
    });

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not trigger onTimeout if user activity occurs before timeout', () => {
    const onTimeout = vi.fn();
    const timeoutMs = 60000;

    const { rerender } = renderHook(
      ({ duration, callback }) => useInactivityTimeout(duration, callback),
      { initialProps: { duration: timeoutMs, callback: onTimeout } }
    );

    // Simulate user activity before timeout
    act(() => {
      vi.advanceTimersByTime(timeoutMs / 2);
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });

    // Re-render to apply the new timeout duration
    rerender({ duration: timeoutMs, callback: onTimeout });

    // Advance past the original timeout
    act(() => {
      vi.advanceTimersByTime(timeoutMs / 2 + 1);
    });

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('resets timer on mousemove event', () => {
    const onTimeout = vi.fn();
    const timeoutMs = 60000;

    renderHook(() => useInactivityTimeout(timeoutMs, onTimeout));

    // Simulate initial activity and partial time passing
    act(() => {
      vi.advanceTimersByTime(timeoutMs - 1000);
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });

    // Advance just past the original timeout
    act(() => {
      vi.advanceTimersByTime(1001);
    });

    // onTimeout should NOT have been called because mousemove reset the timer
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('resets timer on keydown event', () => {
    const onTimeout = vi.fn();
    const timeoutMs = 60000;

    renderHook(() => useInactivityTimeout(timeoutMs, onTimeout));

    act(() => {
      vi.advanceTimersByTime(timeoutMs - 1000);
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    });

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('resets timer on click event', () => {
    const onTimeout = vi.fn();
    const timeoutMs = 60000;

    renderHook(() => useInactivityTimeout(timeoutMs, onTimeout));

    act(() => {
      vi.advanceTimersByTime(timeoutMs - 1000);
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('resets timer on scroll event', () => {
    const onTimeout = vi.fn();
    const timeoutMs = 60000;

    renderHook(() => useInactivityTimeout(timeoutMs, onTimeout));

    act(() => {
      vi.advanceTimersByTime(timeoutMs - 1000);
      document.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('resets timer on touchstart event', () => {
    const onTimeout = vi.fn();
    const timeoutMs = 60000;

    renderHook(() => useInactivityTimeout(timeoutMs, onTimeout));

    act(() => {
      vi.advanceTimersByTime(timeoutMs - 1000);
      document.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
    });

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('clears timer on unmount', () => {
    const onTimeout = vi.fn();
    const timeoutMs = 60000;

    const { unmount } = renderHook(() => useInactivityTimeout(timeoutMs, onTimeout));

    act(() => {
      vi.advanceTimersByTime(timeoutMs);
    });

    expect(onTimeout).toHaveBeenCalledTimes(1);

    unmount();

    // Advance again - should not trigger again since component is unmounted
    act(() => {
      vi.advanceTimersByTime(timeoutMs);
    });

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('uses default timeout of 15 minutes', () => {
    const onTimeout = vi.fn();

    // @ts-expect-error - Testing default parameter
    renderHook(() => useInactivityTimeout(undefined, onTimeout));

    const defaultTimeout = 15 * 60 * 1000; // 15 minutes

    act(() => {
      vi.advanceTimersByTime(defaultTimeout);
    });

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('handles rapid successive activity events correctly', () => {
    const onTimeout = vi.fn();
    const timeoutMs = 60000;

    renderHook(() => useInactivityTimeout(timeoutMs, onTimeout));

    act(() => {
      // Simulate rapid user activity
      vi.advanceTimersByTime(100);
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      
      vi.advanceTimersByTime(50);
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      
      vi.advanceTimersByTime(80);
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    });

    // Advance to just before timeout
    act(() => {
      vi.advanceTimersByTime(timeoutMs - 230);
    });

    expect(onTimeout).not.toHaveBeenCalled();

    // Advance past timeout
    act(() => {
      vi.advanceTimersByTime(231);
    });

    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});

export {};