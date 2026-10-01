import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./lib/wallet/FreighterAdapter', () => {
  class MockFreighterAdapter {
    connect = vi.fn();
    disconnect = vi.fn();
  }

  return { FreighterAdapter: MockFreighterAdapter };
});

vi.mock('./components/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

vi.mock('./components/StatusBanner', () => ({
  StatusBanner: () => <div data-testid="status-banner" />,
}));

vi.mock('./components/DashboardOverview', () => ({ default: () => <div>Dashboard Overview</div> }));
vi.mock('./components/TransactionHistory', () => ({ default: () => <div>Transaction History</div> }));
vi.mock('./components/SEP24Flow', () => ({ default: () => <div>SEP24</div> }));
vi.mock('./components/KycStatusView', () => ({ default: () => <div>KYC</div> }));
vi.mock('./components/NotificationCenter', () => ({ default: () => <div>Notifications</div> }));
vi.mock('./components/NotificationPreferences', () => ({ default: () => <div>Notification Preferences</div> }));
vi.mock('./components/Sep38QuotePanel', () => ({ default: () => <div>Sep38 Quote</div> }));
vi.mock('./components/ServiceStatusPanel', () => ({ default: () => <div>Service Status</div> }));
vi.mock('./components/SettingsView', () => ({ default: () => <div>Settings</div> }));
vi.mock('./components/ContractPlayground', () => ({ default: () => <div>Contract Playground</div> }));

const OPEN_TOGGLE = 'Open navigation menu';
const CLOSE_TOGGLE = 'Close navigation menu';
const BACKDROP = 'Close navigation menu overlay';

const stubViewport = (matches: boolean) => {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
};

describe('App responsive sidebar drawer', () => {
  beforeAll(() => {
    // Resolve presence transitions synchronously so the backdrop mounts/unmounts
    // immediately and assertions observe the settled markup.
    MotionGlobalConfig.skipAnimations = true;
  });

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: null, network: 'testnet' }),
      }),
    );
    document.body.style.overflow = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.style.overflow = '';
  });

  describe('mobile viewport (<640px)', () => {
    beforeEach(() => {
      stubViewport(false);
    });

    it('opens the drawer and its backdrop when the hamburger toggle is clicked', () => {
      render(<App />);

      const toggle = screen.getByRole('button', { name: OPEN_TOGGLE });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveAttribute('aria-controls', 'main-sidebar');
      expect(screen.queryByRole('button', { name: BACKDROP })).toBeNull();

      fireEvent.click(toggle);

      const openToggle = screen.getByRole('button', { name: CLOSE_TOGGLE });
      expect(openToggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: BACKDROP })).toBeTruthy();
    });

    it('closes the drawer when the backdrop is clicked', async () => {
      render(<App />);

      fireEvent.click(screen.getByRole('button', { name: OPEN_TOGGLE }));
      const backdrop = screen.getByRole('button', { name: BACKDROP });

      fireEvent.click(backdrop);

      await waitFor(() => expect(screen.queryByRole('button', { name: BACKDROP })).toBeNull());
      expect(screen.getByRole('button', { name: OPEN_TOGGLE })).toHaveAttribute('aria-expanded', 'false');
    });

    it('locks body scroll while the drawer is open and restores it on close', async () => {
      render(<App />);
      expect(document.body.style.overflow).not.toBe('hidden');

      fireEvent.click(screen.getByRole('button', { name: OPEN_TOGGLE }));
      expect(document.body.style.overflow).toBe('hidden');

      fireEvent.click(screen.getByRole('button', { name: BACKDROP }));
      await waitFor(() => expect(document.body.style.overflow).not.toBe('hidden'));
    });

    it('restores body scroll when the app unmounts with the drawer open', () => {
      const { unmount } = render(<App />);

      fireEvent.click(screen.getByRole('button', { name: OPEN_TOGGLE }));
      expect(document.body.style.overflow).toBe('hidden');

      unmount();
      expect(document.body.style.overflow).not.toBe('hidden');
    });

    it('keeps navigation links reachable in the drawer and closes it on selection', async () => {
      render(<App />);

      fireEvent.click(screen.getByRole('button', { name: OPEN_TOGGLE }));

      const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
      const overviewLink = within(nav).getByRole('button', { name: 'Overview' });
      const historyLink = within(nav).getByRole('button', { name: 'History' });
      expect(overviewLink).toBeTruthy();
      expect(historyLink).toBeTruthy();

      fireEvent.click(historyLink);

      await waitFor(() => expect(screen.queryByRole('button', { name: BACKDROP })).toBeNull());
      expect(document.body.style.overflow).not.toBe('hidden');
      expect(screen.getByRole('heading', { name: 'History' })).toBeTruthy();
    });
  });

  describe('desktop viewport (>=640px)', () => {
    beforeEach(() => {
      stubViewport(true);
    });

    it('renders the docked sidebar without locking body scroll', () => {
      render(<App />);

      const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
      expect(within(nav).getByRole('button', { name: 'Overview' })).toBeTruthy();
      expect(document.body.style.overflow).not.toBe('hidden');
    });
  });
});
