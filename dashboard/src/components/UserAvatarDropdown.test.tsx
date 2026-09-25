import { act, render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserAvatarDropdown } from './UserAvatarDropdown';

describe('UserAvatarDropdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const createMockToken = (expOffsetSeconds: number) => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expOffsetSeconds }));
    const signature = 'signature';
    return `${header}.${payload}.${signature}`;
  };

  it('renders user details correctly', () => {
    render(<UserAvatarDropdown displayName="Test User" email="test@example.com" role="Tester" />);
    expect(screen.getByRole('button', { name: /user menu for test user/i })).toBeInTheDocument();
  });

  it('displays formatted wallet address when provided', () => {
    render(
      <UserAvatarDropdown
        displayName="Test User"
        email="test@example.com"
        role="Tester"
        walletAddress="GABCDEFGHIJKLMNOPQRSTUVWXYZ123456789"
      />
    );
    const trigger = screen.getByRole('button', { name: /user menu for test user/i });
    fireEvent.click(trigger);

    expect(screen.getByText('GABC...6789')).toBeInTheDocument();
  });

  it('displays active session status and handles JWT expiration', async () => {
    localStorage.setItem('authToken', createMockToken(300)); // 5 minutes

    render(<UserAvatarDropdown displayName="Test User" email="test@example.com" role="Tester" />);
    const trigger = screen.getByRole('button', { name: /user menu for test user/i });
    fireEvent.click(trigger);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Should display active session status
    expect(screen.getByText('Session Status')).toBeInTheDocument();
    expect(screen.getByText(/Active \(04:5[89]\)/i)).toBeInTheDocument();
  });

  it('calls onSignOut and purges JWT when logout button is clicked', () => {
    localStorage.setItem('authToken', createMockToken(300));
    const onSignOut = vi.fn();
    render(
      <UserAvatarDropdown
        displayName="Test User"
        email="test@example.com"
        role="Tester"
        onSignOut={onSignOut}
      />
    );

    const trigger = screen.getByRole('button', { name: /user menu for test user/i });
    fireEvent.click(trigger);

    const signOutButton = screen.getByRole('menuitem', { name: /sign out/i });
    fireEvent.click(signOutButton);

    expect(onSignOut).toHaveBeenCalled();
    expect(localStorage.getItem('authToken')).toBeNull();
  });
});
