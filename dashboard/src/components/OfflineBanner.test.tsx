import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineBanner } from './OfflineBanner';

describe('OfflineBanner', () => {
  let onlineGetter: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    onlineGetter = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    onlineGetter.mockRestore();
  });

  it('renders nothing when the browser is online', () => {
    render(<OfflineBanner />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('renders the alert banner when the browser is offline at mount', () => {
    onlineGetter.mockReturnValue(false);
    render(<OfflineBanner />);

    const banner = screen.getByTestId('offline-banner');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toMatch(/no internet connection/i);
  });

  it('shows the banner when the offline event fires', () => {
    render(<OfflineBanner />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByTestId('offline-banner')).toBeTruthy();
  });

  it('hides the banner when the online event fires after going offline', () => {
    onlineGetter.mockReturnValue(false);
    render(<OfflineBanner />);
    expect(screen.getByTestId('offline-banner')).toBeTruthy();

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('uses aria-live="assertive" so screen readers announce the alert immediately', () => {
    onlineGetter.mockReturnValue(false);
    render(<OfflineBanner />);

    const banner = screen.getByTestId('offline-banner');
    expect(banner.getAttribute('aria-live')).toBe('assertive');
  });
});
