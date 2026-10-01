import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardOverview, parseStatusFilter, readStatusFilterFromUrl } from './DashboardOverview';

const uiConfig = {
  brandName: 'AnchorPoint',
  primaryColor: '#3b82f6',
  accentColor: '#14b8a6',
  supportEmail: 'support@anchorpoint.local',
  fieldRequirements: { deposit: [], withdraw: [], kyc: [] },
};

const renderOverview = () => render(<DashboardOverview uiConfig={uiConfig} />);

describe('DashboardOverview status filter', () => {
  const originalLocation = window.location;
  const originalReplaceState = window.history.replaceState;

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, search: '', href: 'http://localhost/' },
    });
    window.history.replaceState = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    window.history.replaceState = originalReplaceState;
  });

  it('renders the four status filter chips', () => {
    renderOverview();

    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pending' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Completed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Failed' })).toBeTruthy();
  });

  it('renders the staking estimator widget in the dashboard', () => {
    renderOverview();

    expect(screen.getByRole('heading', { name: /staking yield estimator/i })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /lock duration/i })).toBeInTheDocument();
  });

  it('defaults to the All filter', () => {
    renderOverview();

    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('selecting a chip filters the transaction list synchronously', () => {
    renderOverview();

    // Initially shows every mock transaction (status badges are rendered per row).
    const initialRows = screen.getAllByRole('status').length;
    expect(initialRows).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));

    // Only Failed transactions remain; all rows carry the Failed badge.
    const badges = screen.getAllByRole('status', { name: /transaction status: failed/i });
    expect(badges.length).toBeGreaterThan(0);
    const pendingBadges = screen.queryAllByRole('status', { name: /transaction status: pending/i });
    const completedBadges = screen.queryAllByRole('status', { name: /transaction status: completed/i });
    expect(pendingBadges).toHaveLength(0);
    expect(completedBadges).toHaveLength(0);
  });

  it('shows an empty state when no transactions match', () => {
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    fireEvent.change(screen.getByLabelText('Quick search transactions'), {
      target: { value: 'zzzz-no-match' },
    });

    expect(screen.getByText(/No transactions match/i)).toBeTruthy();
  });

  it('persists the selected filter to the URL (?status=…)', () => {
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));

    expect(window.history.replaceState).toHaveBeenCalledWith(
      null,
      '',
      expect.stringContaining('status=pending')
    );
  });

  it('restores the filter from the URL on mount', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, search: '?status=failed', href: 'http://localhost/?status=failed' },
    });

    renderOverview();

    expect(screen.getByRole('button', { name: 'Failed' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('parses URL status values with fallback to All for unknown values', () => {
    expect(parseStatusFilter('pending')).toBe('Pending');
    expect(parseStatusFilter('completed')).toBe('Completed');
    expect(parseStatusFilter('failed')).toBe('Failed');
    expect(parseStatusFilter('bogus')).toBe('All');
    expect(parseStatusFilter(null)).toBe('All');
  });

  it('reads the status filter from the current URL', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, search: '?status=completed', href: 'http://localhost/?status=completed' },
    });

    expect(readStatusFilterFromUrl()).toBe('Completed');
  });
});
