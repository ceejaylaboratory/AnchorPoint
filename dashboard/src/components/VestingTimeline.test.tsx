import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VestingSchedule, VestingTimeline, computeVestingProgress } from './VestingTimeline';

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);

const schedule = (overrides: Partial<VestingSchedule> = {}): VestingSchedule => ({
  id: 'v1',
  tokenSymbol: 'ANCHOR',
  totalAmount: 1_000,
  claimedAmount: 0,
  startTime: START,
  cliffTime: START + 25 * DAY,
  endTime: START + 100 * DAY,
  ...overrides,
});

describe('computeVestingProgress', () => {
  it('vests nothing before the cliff and points the next unlock at the cliff', () => {
    const p = computeVestingProgress(schedule(), START + 10 * DAY);
    expect(p.phase).toBe('before-cliff');
    expect(p.vestedPercent).toBe(0);
    expect(p.lockedPercent).toBe(100);
    expect(p.claimableAmount).toBe(0);
    expect(p.nextUnlockTime).toBe(START + 25 * DAY);
    expect(p.elapsedPercent).toBe(10);
    expect(p.cliffPercent).toBe(25);
  });

  it('releases the accrued amount at the cliff and vests linearly afterwards', () => {
    expect(computeVestingProgress(schedule(), START + 25 * DAY).vestedPercent).toBe(25);

    const p = computeVestingProgress(schedule({ claimedAmount: 100 }), START + 40 * DAY);
    expect(p.phase).toBe('vesting');
    expect(p.vestedAmount).toBe(400);
    expect(p.lockedAmount).toBe(600);
    expect(p.vestedPercent).toBe(40);
    expect(p.lockedPercent).toBe(60);
    expect(p.claimableAmount).toBe(300);
    expect(p.nextUnlockTime).toBeNull();
  });

  it('vests in whole steps when an unlock interval is set', () => {
    const p = computeVestingProgress(
      schedule({ unlockIntervalMs: 10 * DAY }),
      START + 47 * DAY,
    );
    expect(p.vestedPercent).toBe(40);
    expect(p.nextUnlockTime).toBe(START + 50 * DAY);
  });

  it('is fully vested at and after the end time', () => {
    const p = computeVestingProgress(schedule({ claimedAmount: 250 }), START + 120 * DAY);
    expect(p.phase).toBe('fully-vested');
    expect(p.vestedPercent).toBe(100);
    expect(p.lockedPercent).toBe(0);
    expect(p.claimableAmount).toBe(750);
    expect(p.nextUnlockTime).toBeNull();
    expect(p.elapsedPercent).toBe(100);
  });

  it('never reports negative claimable when claims exceed vested', () => {
    const p = computeVestingProgress(schedule({ claimedAmount: 900 }), START + 50 * DAY);
    expect(p.claimableAmount).toBe(0);
  });
});

describe('VestingTimeline', () => {
  it('renders the vested vs locked progress bar', () => {
    render(<VestingTimeline schedules={[schedule()]} now={START + 40 * DAY} />);

    const bar = screen.getByRole('progressbar', { name: /vested percentage/i });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuetext', '40% vested, 60% locked');
    expect(screen.getByTestId('vesting-progress-vested')).toHaveStyle({ width: '40%' });
    expect(screen.getByText(/Vested 40%/)).toBeInTheDocument();
    expect(screen.getByText(/Locked 60%/)).toBeInTheDocument();
  });

  it('places the cliff and now markers on the timeline', () => {
    render(<VestingTimeline schedules={[schedule()]} now={START + 10 * DAY} />);

    expect(screen.getByTestId('vesting-marker-cliff')).toHaveStyle({ left: '25%' });
    expect(screen.getByTestId('vesting-marker-now')).toHaveStyle({ left: '10%' });
    expect(screen.getByText('Before cliff')).toBeInTheDocument();
  });

  it('shows the cliff as the next unlock and disables claiming before the cliff', () => {
    render(<VestingTimeline schedules={[schedule()]} now={START + 10 * DAY} onClaim={vi.fn()} />);

    expect(screen.getByTestId('vesting-next-unlock')).toHaveTextContent(
      new Date(START + 25 * DAY).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    );
    expect(screen.getByTestId('vesting-claimable')).toHaveTextContent('0 ANCHOR');
    expect(screen.getByRole('button', { name: /claim vested tokens/i })).toBeDisabled();
  });

  it('calls onClaim with the schedule id when tokens are claimable', async () => {
    const onClaim = vi.fn().mockResolvedValue(undefined);
    render(
      <VestingTimeline
        schedules={[schedule({ id: 'grant-7' })]}
        now={START + 50 * DAY}
        onClaim={onClaim}
      />,
    );

    const card = screen.getByTestId('vesting-schedule-grant-7');
    expect(within(card).getByTestId('vesting-claimable')).toHaveTextContent('500 ANCHOR');
    await userEvent.click(within(card).getByRole('button', { name: /claim vested tokens/i }));
    await waitFor(() => expect(onClaim).toHaveBeenCalledWith('grant-7'));
  });

  it('hides schedules that are fully claimed and shows an empty state', () => {
    render(
      <VestingTimeline
        schedules={[schedule({ claimedAmount: 1_000 })]}
        now={START + 200 * DAY}
      />,
    );
    expect(screen.getByText(/no active vesting schedules/i)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
