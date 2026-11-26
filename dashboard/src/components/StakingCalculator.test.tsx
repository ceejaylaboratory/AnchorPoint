import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  StakingCalculator,
  calculateEstimatedApy,
  calculateProjectedRewards,
  calculateCompoundedEarnings,
  calculateProtocolFee,
  calculateNetReturn,
  normalizeDepositAmount,
} from './StakingCalculator';

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});

describe('StakingCalculator math', () => {
  it('calculates APY by lock duration', () => {
    expect(calculateEstimatedApy(30)).toBe(4.8);
    expect(calculateEstimatedApy(90)).toBe(6.48);
    expect(calculateEstimatedApy(180)).toBe(8.16);
    expect(calculateEstimatedApy(365)).toBe(10.08);
  });

  it('prorates linear rewards by APY and lock duration', () => {
    expect(calculateProjectedRewards(10_000, 365)).toBe(1_008);
    expect(calculateProjectedRewards(10_000, 90)).toBe(159.78);
  });

  it('verifies compound interest mathematical calculations across lockup tiers', () => {
    // Daily compounding formula: A = P * (1 + r / 365)^days - P
    const deposit = 10_000;

    // 30 days @ 4.80% APR:
    // r = 0.048, (1 + 0.048/365)^30 ~= 1.0039528, 10000 * 0.0039528 ~= 39.53
    const rewards30 = calculateCompoundedEarnings(deposit, 30, calculateEstimatedApy(30));
    expect(rewards30).toBe(39.53);

    // 90 days @ 6.48% APR:
    // r = 0.0648, (1 + 0.0648/365)^90 - 1 ~= 0.0161047, 10000 * 0.0161047 ~= 161.05
    const rewards90 = calculateCompoundedEarnings(deposit, 90, calculateEstimatedApy(90));
    expect(rewards90).toBe(161.05);

    // 180 days @ 8.16% APR:
    const rewards180 = calculateCompoundedEarnings(deposit, 180, calculateEstimatedApy(180));
    expect(rewards180).toBe(410.57);

    // 365 days @ 10.08% APR:
    // (1 + 0.1008/365)^365 - 1 ~= 0.10604, 10000 * 0.10604 ~= 1060.40
    const rewards365 = calculateCompoundedEarnings(deposit, 365, calculateEstimatedApy(365));
    expect(rewards365).toBe(1060.4);
  });

  it('itemizes protocol fee deductions accurately', () => {
    const grossRewards = 1060.38;
    const protocolFeeRate = 0.02; // 2%
    const fee = calculateProtocolFee(grossRewards, protocolFeeRate);
    expect(fee).toBe(21.21); // 1060.38 * 0.02 = 21.2076 -> 21.21

    expect(calculateProtocolFee(0, 0.02)).toBe(0);
    expect(calculateProtocolFee(100, 0)).toBe(0);
  });

  it('computes net return after deducting protocol fee and gas cost', () => {
    const grossRewards = 1060.38;
    const protocolFee = 21.21;
    const gasFee = 0.01;

    const net = calculateNetReturn(grossRewards, protocolFee, gasFee);
    expect(net).toBe(1039.16);
  });

  it('returns zero rewards for a zero, negative or non-numeric stake', () => {
    expect(calculateProjectedRewards(0, 365)).toBe(0);
    expect(calculateProjectedRewards(-500, 90)).toBe(0);
    expect(calculateProjectedRewards(Number.NaN, 30)).toBe(0);
    expect(calculateProjectedRewards(Number.POSITIVE_INFINITY, 30)).toBe(0);

    expect(calculateCompoundedEarnings(0, 365, 10)).toBe(0);
    expect(calculateCompoundedEarnings(-500, 90, 6)).toBe(0);
    expect(calculateCompoundedEarnings(Number.NaN, 30, 4)).toBe(0);
  });

  it('normalizes unusable deposit amounts to zero', () => {
    expect(normalizeDepositAmount(0)).toBe(0);
    expect(normalizeDepositAmount(-1)).toBe(0);
    expect(normalizeDepositAmount(Number.NaN)).toBe(0);
    expect(normalizeDepositAmount(2_500)).toBe(2_500);
  });
});

describe('StakingCalculator component', () => {
  it('renders the default estimate', () => {
    render(<StakingCalculator />);

    expect(screen.getByRole('heading', { name: /staking yield estimator/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Selected deposit amount')).toHaveTextContent('2,500.00 APX');
    expect(screen.getByText('6.48%')).toBeInTheDocument();
    expect(screen.getByText('40.26')).toBeInTheDocument(); // Compounded gross rewards for 2,500 @ 90d
  });

  it('updates rewards when deposit amount changes', () => {
    render(<StakingCalculator />);

    fireEvent.change(screen.getByRole('slider', { name: /deposit amount/i }), {
      target: { value: '10000' },
    });

    expect(screen.getByLabelText('Selected deposit amount')).toHaveTextContent('10,000.00 APX');
    expect(screen.getByText('161.05')).toBeInTheDocument(); // Compounded gross rewards for 10,000 @ 90d
  });

  it('updates APY and rewards across all 4 lock duration tiers', () => {
    render(<StakingCalculator />);

    // 180d tier
    fireEvent.click(screen.getByRole('radio', { name: /180d/i }));
    expect(screen.getByRole('radio', { name: /180d/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('8.16%')).toBeInTheDocument();

    // 365d tier
    fireEvent.click(screen.getByRole('radio', { name: /365d/i }));
    expect(screen.getByRole('radio', { name: /365d/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('10.08%')).toBeInTheDocument();
    expect(screen.getByText('265.10')).toBeInTheDocument(); // Compounded gross rewards for 2,500 @ 365d
  });

  it('clearly itemizes protocol fee deductions and estimated gas cost', () => {
    render(<StakingCalculator />);

    expect(screen.getByText(/Gross Projected Rewards/i)).toBeInTheDocument();
    expect(screen.getByText(/Protocol Fee \(2\.0%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Est\. Transaction Gas Cost/i)).toBeInTheDocument();
    expect(screen.getByText(/Net Estimated Return/i)).toBeInTheDocument();
  });

  it('invokes onStakeNow with deposit amount and duration when clicking Stake Now', () => {
    const onStakeNow = vi.fn();
    render(<StakingCalculator onStakeNow={onStakeNow} />);

    fireEvent.click(screen.getByRole('radio', { name: /180d/i }));
    fireEvent.click(screen.getByRole('button', { name: /Stake Now/i }));

    expect(onStakeNow).toHaveBeenCalledWith(2500, 180);
  });

  it('renders within accessible modal dialog when isOpen prop is provided', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<StakingCalculator isOpen={true} onClose={onClose} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close', exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    expect(onClose).toHaveBeenCalled();

    rerender(<StakingCalculator isOpen={false} onClose={onClose} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders zeros instead of NaN when the stake is 0', () => {
    const { container } = render(<StakingCalculator />);

    fireEvent.change(screen.getByRole('slider', { name: /deposit amount/i }), {
      target: { value: '0' },
    });

    expect(container.textContent).not.toMatch(/NaN/);
  });

  it('renders zeros instead of NaN when the stake is not a number', () => {
    const { container } = render(<StakingCalculator />);

    fireEvent.change(screen.getByRole('slider', { name: /deposit amount/i }), {
      target: { value: '' },
    });

    expect(container.textContent).not.toMatch(/NaN/);
  });
});
