import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBanner } from './StatusBanner';

describe('StatusBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    // Reset navigator.onLine to online by default
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
    });
  });

  it('renders a fetched banner and dismisses it for the current session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'success', data: { bannerMessage: 'Planned maintenance tonight at 22:00 UTC' } }),
      }),
    );

    render(<StatusBanner apiBaseUrl="http://localhost:3002" />);

    expect(await screen.findByText('Planned maintenance tonight at 22:00 UTC')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dismiss notification/i }));

    await waitFor(() => {
      expect(screen.queryByText('Planned maintenance tonight at 22:00 UTC')).not.toBeInTheDocument();
    });
  });

  it('displays offline banner when network goes offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'success', data: { bannerMessage: 'Planned maintenance tonight at 22:00 UTC' } }),
      }),
    );

    render(<StatusBanner apiBaseUrl="http://localhost:3002" />);

    // Verify initial online state shows maintenance banner
    expect(await screen.findByText('Planned maintenance tonight at 22:00 UTC')).toBeInTheDocument();

    // Simulate offline event
    Object.defineProperty(navigator, 'onLine', { value: false });
    window.dispatchEvent(new Event('offline'));

    // Should now show offline banner instead
    expect(await screen.findByText('Internet connection lost. Retrying...')).toBeInTheDocument();
    expect(screen.queryByText('Planned maintenance tonight at 22:00 UTC')).not.toBeInTheDocument();
  });

  it('hides offline banner and refreshes page when network comes back online', async () => {
    // Start in offline state
    Object.defineProperty(navigator, 'onLine', { value: false });
    
    // Mock location.reload
    const reloadMock = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'success', data: { bannerMessage: 'Planned maintenance tonight at 22:00 UTC' } }),
      }),
    );

    render(<StatusBanner apiBaseUrl="http://localhost:3002" />);

    // Verify offline banner is shown initially
    expect(await screen.findByText('Internet connection lost. Retrying...')).toBeInTheDocument();

    // Simulate online event
    Object.defineProperty(navigator, 'onLine', { value: true });
    window.dispatchEvent(new Event('online'));

    // Should have called reload to refresh active view
    expect(reloadMock).toHaveBeenCalledTimes(1);

    // Restore original location
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('shows offline banner on initial render if starting offline', () => {
    // Start in offline state
    Object.defineProperty(navigator, 'onLine', { value: false });

    render(<StatusBanner apiBaseUrl="http://localhost:3002" />);

    // Offline banner should be visible immediately
    expect(screen.getByText('Internet connection lost. Retrying...')).toBeInTheDocument();
  });
});