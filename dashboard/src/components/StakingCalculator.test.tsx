import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  StakingCalculator,
  calculateEstimatedApy,
  calculateProjectedRewards,
} from './StakingCalculator';

describe('StakingCalculator math', () => {
  it('calculates APY by lock duration', () => {
    expect(calculateEstimatedApy(30)).toBe(4.8);
    expect(calculateEstimatedApy(90)).toBe(6.48);
    expect(calculateEstimatedApy(365)).toBe(10.08);
  });

  it('prorates rewards by APY and lock duration', () => {
    expect(calculateProjectedRewards(10_000, 365)).toBe(1_008);
    expect(calculateProjectedRewards(10_000, 90)).toBe(159.78);
  });
});

describe('StakingCalculator component', () => {
  it('renders the default estimate', () => {
    render(<StakingCalculator />);

    expect(screen.getByRole('heading', { name: /staking yield estimator/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Selected deposit amount')).toHaveTextContent('2,500.00 APX');
    expect(screen.getByText('6.48%')).toBeInTheDocument();
    expect(screen.getByText('39.95')).toBeInTheDocument();
  });

  it('updates rewards when deposit amount changes', () => {
    render(<StakingCalculator />);

    fireEvent.change(screen.getByRole('slider', { name: /deposit amount/i }), {
      target: { value: '10000' },
    });

    expect(screen.getByLabelText('Selected deposit amount')).toHaveTextContent('10,000.00 APX');
    expect(screen.getByText('159.78')).toBeInTheDocument();
  });

  it('updates APY and rewards when lock duration changes', () => {
    render(<StakingCalculator />);

    fireEvent.click(screen.getByRole('radio', { name: '365d' }));

    expect(screen.getByRole('radio', { name: '365d' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('10.08%')).toBeInTheDocument();
    expect(screen.getByText('252.00')).toBeInTheDocument();
  });
});
