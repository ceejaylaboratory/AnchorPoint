import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StakingDashboard from './StakingDashboard';
import { I18nProvider } from '../i18n/config';

const renderDashboard = (props = {}) => {
  return render(
    <I18nProvider>
      <StakingDashboard {...props} />
    </I18nProvider>,
  );
};

describe('StakingDashboard component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders live staking metrics: staked amount, rewards, lock tier, unlock date, and APY', async () => {
    const mockPosition = {
      stakedAmount: 12500,
      currentRewards: 320.75,
      lockTier: '90_days',
      lockDurationDays: 90,
      unlockDate: '2026-12-31T00:00:00.000Z',
      apy: 6.48,
      stakedAt: '2026-10-01T00:00:00.000Z',
      isUnlocked: false,
      asset: 'APX',
    };

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockPosition,
    } as Response);

    renderDashboard();

    // Check heading and live indicator
    expect(screen.getByTestId('staking-dashboard')).toBeTruthy();
    expect(screen.getByTestId('live-position-badge')).toBeTruthy();

    // Staked balance
    await waitFor(() => {
      expect(screen.getByTestId('staked-amount').textContent).toContain('12,500.00');
    });

    // Current rewards
    expect(screen.getByTestId('current-rewards').textContent).toContain('+320.75');

    // Lock tier
    expect(screen.getByTestId('lock-tier').textContent).toContain('90');

    // Unlock date
    expect(screen.getByTestId('unlock-date')).toBeTruthy();

    // APY
    expect(screen.getByTestId('apy-badge').textContent).toContain('6.48% APY');
  });

  it('handles backend network errors gracefully using active fallback position', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('staked-amount').textContent).toContain('5,000.00');
    });

    expect(screen.getByTestId('current-rewards').textContent).toContain('+142.50');
    expect(screen.getByTestId('apy-badge').textContent).toContain('6.48% APY');
  });

  it('supports staking tokens through input and confirmation modals', async () => {
    const mockPosition = {
      stakedAmount: 5000,
      currentRewards: 50,
      lockTier: '90_days',
      lockDurationDays: 90,
      unlockDate: '2026-12-31T00:00:00.000Z',
      apy: 6.48,
      stakedAt: '2026-10-01T00:00:00.000Z',
      isUnlocked: false,
      asset: 'APX',
    };

    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/position')) {
        return { ok: true, json: async () => mockPosition } as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as Response;
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('staked-amount').textContent).toContain('5,000.00');
    });

    // Click Stake More button
    const stakeBtn = screen.getByTestId('stake-button');
    fireEvent.click(stakeBtn);

    // Stake modal should be open
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText(/Amount to stake/i)).toBeTruthy();

    // Input new amount: 1500
    const input = screen.getByTestId('stake-amount-input');
    fireEvent.change(input, { target: { value: '1500' } });

    // Click Review Stake
    const reviewBtn = screen.getByTestId('review-stake-button');
    fireEvent.click(reviewBtn);

    // Confirmation modal is displayed
    expect(screen.getByRole('heading', { name: /Confirm Staking Position/i })).toBeTruthy();

    // Confirm Stake
    const confirmBtn = screen.getByTestId('confirm-stake-execute-button');
    fireEvent.click(confirmBtn);

    // Position updates to 5000 + 1500 = 6500
    await waitFor(() => {
      expect(screen.getByTestId('staked-amount').textContent).toContain('6,500.00');
    });

    // Feedback message is shown
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('supports unstaking tokens with early warning fee calculation and confirmation modal', async () => {
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString();
    const mockPosition = {
      stakedAmount: 4000,
      currentRewards: 100,
      lockTier: '90_days',
      lockDurationDays: 90,
      unlockDate: futureDate,
      apy: 6.48,
      stakedAt: '2026-09-01T00:00:00.000Z',
      isUnlocked: false,
      asset: 'APX',
    };

    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/position')) {
        return { ok: true, json: async () => mockPosition } as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as Response;
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('staked-amount').textContent).toContain('4,000.00');
    });

    // Click Unstake button
    const unstakeBtn = screen.getByTestId('unstake-button');
    fireEvent.click(unstakeBtn);

    // Unstake modal opens and displays early unstake warning
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByTestId('early-unstake-warning')).toBeTruthy();

    // Input unstake amount: 1000
    const input = screen.getByTestId('unstake-amount-input');
    fireEvent.change(input, { target: { value: '1000' } });

    // Click Review Unstake
    const reviewBtn = screen.getByTestId('review-unstake-button');
    fireEvent.click(reviewBtn);

    // Confirmation modal opens
    expect(screen.getByRole('heading', { name: /Confirm Unstaking/i })).toBeTruthy();

    // Confirm unstake execution
    const confirmBtn = screen.getByTestId('confirm-unstake-execute-button');
    fireEvent.click(confirmBtn);

    // Remaining stake is 4000 - 1000 = 3000
    await waitFor(() => {
      expect(screen.getByTestId('staked-amount').textContent).toContain('3,000.00');
    });
  });

  it('allows claiming accrued rewards', async () => {
    const mockPosition = {
      stakedAmount: 5000,
      currentRewards: 250,
      lockTier: '90_days',
      lockDurationDays: 90,
      unlockDate: '2026-12-31T00:00:00.000Z',
      apy: 6.48,
      stakedAt: '2026-10-01T00:00:00.000Z',
      isUnlocked: false,
      asset: 'APX',
    };

    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/position')) {
        return { ok: true, json: async () => mockPosition } as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as Response;
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId('current-rewards').textContent).toContain('+250.00');
    });

    const claimBtn = screen.getByTestId('claim-button');
    fireEvent.click(claimBtn);

    await waitFor(() => {
      expect(screen.getByTestId('current-rewards').textContent).toContain('+0.00');
    });

    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('toggles the integrated yield estimator preview', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stakedAmount: 1000,
        currentRewards: 10,
        lockTier: '30_days',
        lockDurationDays: 30,
        unlockDate: new Date().toISOString(),
        apy: 4.8,
        stakedAt: new Date().toISOString(),
        isUnlocked: true,
        asset: 'APX',
      }),
    } as Response);

    renderDashboard();

    const toggleBtn = screen.getByTestId('toggle-estimator-button');
    fireEvent.click(toggleBtn);

    expect(screen.getByText(/30 Days/)).toBeTruthy();
    expect(screen.getAllByText(/90 Days/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/365 Days/)).toBeTruthy();
  });

  it('opens APR simulation modal and pre-fills staking form when Stake Now is clicked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        stakedAmount: 1000,
        currentRewards: 10,
        lockTier: '30_days',
        lockDurationDays: 30,
        unlockDate: new Date().toISOString(),
        apy: 4.8,
        stakedAt: new Date().toISOString(),
        isUnlocked: true,
        asset: 'APX',
      }),
    } as Response);

    renderDashboard();

    const openCalculatorBtn = screen.getByTestId('open-calculator-modal-button');
    fireEvent.click(openCalculatorBtn);

    // Calculator modal is open
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Gross Projected Rewards/i)).toBeInTheDocument();

    // Select 180d tier and click Stake Now in calculator
    fireEvent.click(screen.getByRole('radio', { name: /180d/i }));
    fireEvent.click(screen.getByRole('button', { name: /Stake Now/i }));

    // Stake modal should now be open and pre-filled with selected duration and amount
    await waitFor(() => {
      expect(screen.getByTestId('stake-amount-input')).toHaveValue(500);
      expect(screen.getByRole('radio', { name: /180 Days/i })).toHaveAttribute('aria-checked', 'true');
    });
  });
});
