import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InactivityWarningModal, SessionLockedOverlay, formatCountdown } from './SessionLock';

describe('formatCountdown', () => {
  it('rounds up to whole seconds as mm:ss', () => {
    expect(formatCountdown(60_000)).toBe('01:00');
    expect(formatCountdown(59_001)).toBe('01:00');
    expect(formatCountdown(4_200)).toBe('00:05');
    expect(formatCountdown(null)).toBe('00:00');
  });
});

describe('InactivityWarningModal', () => {
  it('shows the countdown and a Stay Logged In action', () => {
    const onStay = vi.fn();
    const onLock = vi.fn();
    render(
      <InactivityWarningModal isOpen remainingMs={42_000} onStayLoggedIn={onStay} onLockNow={onLock} />,
    );

    expect(screen.getByRole('dialog', { name: /are you still there/i })).toBeInTheDocument();
    expect(screen.getByTestId('inactivity-countdown')).toHaveTextContent('00:42');

    fireEvent.click(screen.getByRole('button', { name: /stay logged in/i }));
    expect(onStay).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /lock now/i }));
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    render(
      <InactivityWarningModal isOpen={false} remainingMs={null} onStayLoggedIn={vi.fn()} onLockNow={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('SessionLockedOverlay', () => {
  it('covers the app, names the view to resume and focuses Reconnect', () => {
    const onUnlock = vi.fn();
    render(<SessionLockedOverlay isLocked onUnlock={onUnlock} resumeLabel="Deposit" />);

    expect(screen.getByRole('dialog', { name: /session locked/i })).toBeInTheDocument();
    expect(screen.getByText(/continue where you left off \(Deposit\)/)).toBeInTheDocument();

    const button = screen.getByRole('button', { name: /reconnect wallet/i });
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while unlocked', () => {
    render(<SessionLockedOverlay isLocked={false} onUnlock={vi.fn()} />);
    expect(screen.queryByTestId('session-locked-overlay')).toBeNull();
  });
});
