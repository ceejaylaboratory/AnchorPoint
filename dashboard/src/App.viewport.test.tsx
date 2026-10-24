import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { TransactionHistory, type Transaction } from './components/TransactionHistory';

vi.mock('./components/DashboardOverview', () => ({
  default: () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      Dashboard Overview
    </div>
  ),
}));

const stubMediaQuery = (query: string, matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      media: q,
      matches,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  });
};

describe('Responsive layout viewport', () => {
  beforeEach(() => {
    class MockEventSource {
      close = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      onerror = null;
      onmessage = null;
      onopen = null;
    }
    vi.stubGlobal('EventSource', MockEventSource);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: null, network: 'testnet' }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders single-column grid on mobile (<640px)', async () => {
    stubMediaQuery('(max-width: 639px)', true);
    stubMediaQuery('(min-width: 640px)', false);

    render(<App />);

    await screen.findByText('Dashboard Overview');

    // Check for the grid container - should have single column layout on mobile
    const gridContainer = document.querySelector('.grid');
    expect(gridContainer).toHaveClass('grid-cols-1');
  });

  it('renders two-column grid on small tablets (640px-767px)', async () => {
    stubMediaQuery('(max-width: 639px)', false);
    stubMediaQuery('(min-width: 640px)', true);
    stubMediaQuery('(max-width: 767px)', true);

    render(<App />);

    await screen.findByText('Dashboard Overview');

    const gridContainer = document.querySelector('.grid');
    expect(gridContainer).toHaveClass('sm:grid-cols-2');
  });

  it('renders three-column grid on desktop (>=768px)', async () => {
    stubMediaQuery('(max-width: 767px)', false);
    stubMediaQuery('(min-width: 768px)', true);
    stubMediaQuery('(max-width: 1023px)', true);

    render(<App />);

    await screen.findByText('Dashboard Overview');

    const gridContainer = document.querySelector('.grid');
    expect(gridContainer).toHaveClass('lg:grid-cols-3');
  });

  it('shows hamburger menu on mobile (<640px)', () => {
    stubMediaQuery('(max-width: 639px)', true);
    stubMediaQuery('(min-width: 640px)', false);

    render(<App />);

    const menuButton = screen.getByRole('button', { name: /^(open|close) navigation menu$/i });
    expect(menuButton).toBeInTheDocument();
  });

  it('hides hamburger menu on desktop (>=640px)', () => {
    stubMediaQuery('(max-width: 639px)', false);
    stubMediaQuery('(min-width: 640px)', true);

    render(<App />);

    const menuButton = screen.getByRole('button', { name: /^(open|close) navigation menu$/i });
    expect(menuButton).toHaveClass('sm:hidden');
  });

  it('displays sidebar as drawer on mobile', () => {
    stubMediaQuery('(max-width: 639px)', true);
    stubMediaQuery('(min-width: 640px)', false);

    render(<App />);

    const sidebar = screen.getByRole('complementary', { name: /main navigation/i });
    expect(sidebar).toHaveClass('fixed');
  });

  it('displays sidebar as docked on desktop', () => {
    stubMediaQuery('(max-width: 639px)', false);
    stubMediaQuery('(min-width: 640px)', true);

    render(<App />);

    const sidebar = screen.getByRole('complementary', { name: /main navigation/i });
    expect(sidebar).toHaveClass('sm:relative');
  });
});

describe('TransactionHistory mobile responsiveness and breakpoint tests', () => {
  const sampleTransactions: Transaction[] = [
    {
      id: 'TX-100',
      hash: '0x9f4a00000001',
      type: 'Deposit',
      asset: 'USDC',
      amount: '150.00',
      counterparty: 'GABCD...WXYZ',
      status: 'Completed',
      date: '2024-03-20',
      timestamp: 1710500000000,
      fee: '0.00001 XLM',
    },
    {
      id: 'TX-99',
      hash: '0x9f4a00000002',
      type: 'Withdrawal',
      asset: 'XLM',
      amount: '75.50',
      counterparty: 'GDCBA...ZYXW',
      status: 'Pending',
      date: '2024-03-21',
      timestamp: 1710500090000,
      fee: '0.00001 XLM',
    },
  ];

  it('renders card-based list layout on mobile with hidden table header and visible mobile cards', () => {
    stubMediaQuery('(max-width: 767px)', true);
    stubMediaQuery('(min-width: 768px)', false);

    render(<TransactionHistory initialData={sampleTransactions} totalInitialCount={2} />);

    // Table header should have hidden on mobile breakpoint (<768px / md:)
    const header = screen.getByTestId('tx-table-header');
    expect(header).toHaveClass('hidden');
    expect(header).toHaveClass('md:grid');

    // Desktop row container should have hidden on mobile (<768px / md:)
    const desktopRow = screen.getByTestId('tx-desktop-row-0');
    expect(desktopRow).toHaveClass('hidden');
    expect(desktopRow).toHaveClass('md:grid');

    // Mobile card container should be visible on mobile (<768px) and hidden on md:
    const mobileCard = screen.getByTestId('tx-card-0');
    expect(mobileCard).toHaveClass('md:hidden');
  });

  it('renders desktop table layout with 12-column grid on desktop viewports (>=768px)', () => {
    stubMediaQuery('(max-width: 767px)', false);
    stubMediaQuery('(min-width: 768px)', true);

    render(<TransactionHistory initialData={sampleTransactions} totalInitialCount={2} />);

    const header = screen.getByTestId('tx-table-header');
    expect(header).toHaveClass('md:grid');
    expect(header).toHaveClass('grid-cols-12');

    const desktopRow = screen.getByTestId('tx-desktop-row-0');
    expect(desktopRow).toHaveClass('md:grid');
    expect(desktopRow).toHaveClass('grid-cols-12');
  });

  it('displays all key fields (status, amount, asset, date) on mobile card without horizontal scrolling', () => {
    render(<TransactionHistory initialData={sampleTransactions} totalInitialCount={2} />);

    // Status is displayed
    const statusBadge = screen.getByTestId('tx-card-status-0');
    expect(statusBadge).toHaveTextContent('Completed');

    // Amount and asset are displayed
    const amountElem = screen.getByTestId('tx-card-amount-0');
    expect(amountElem).toHaveTextContent('+150.00 USDC');

    // Date is displayed
    const dateElem = screen.getByTestId('tx-card-date-0');
    expect(dateElem).toHaveTextContent('2024-03-20');

    // Expand button is displayed
    const expandBtn = screen.getByTestId('tx-card-expand-btn-0');
    expect(expandBtn).toBeInTheDocument();
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps secondary fields collapsed by default and expands them on user interaction', () => {
    render(<TransactionHistory initialData={sampleTransactions} totalInitialCount={2} />);

    // Secondary fields are initially collapsed/hidden
    expect(screen.queryByTestId('tx-card-secondary-0')).not.toBeInTheDocument();

    // Click expand details button
    const expandBtn = screen.getByTestId('tx-card-expand-btn-0');
    fireEvent.click(expandBtn);

    // Secondary fields are now visible
    const secondaryDetails = screen.getByTestId('tx-card-secondary-0');
    expect(secondaryDetails).toBeInTheDocument();
    expect(secondaryDetails).toHaveTextContent('TX-100');
    expect(secondaryDetails).toHaveTextContent('Deposit');
    expect(secondaryDetails).toHaveTextContent('0x9f4a00000001');
    expect(secondaryDetails).toHaveTextContent('GABCD...WXYZ');
    expect(secondaryDetails).toHaveTextContent('0.00001 XLM');

    expect(expandBtn).toHaveAttribute('aria-expanded', 'true');
    expect(expandBtn).toHaveTextContent('Hide Details');

    // Click collapse button
    fireEvent.click(expandBtn);
    expect(screen.queryByTestId('tx-card-secondary-0')).not.toBeInTheDocument();
    expect(expandBtn).toHaveAttribute('aria-expanded', 'false');
    expect(expandBtn).toHaveTextContent('Details');
  });

  it('spaces rows for card height on mobile (<768px) so cards do not overlap', () => {
    stubMediaQuery('(max-width: 767px)', true);

    render(<TransactionHistory initialData={sampleTransactions} totalInitialCount={2} />);

    expect(screen.getByTestId('tx-row-0')).toHaveStyle({ transform: 'translateY(0px)' });
    expect(screen.getByTestId('tx-row-1')).toHaveStyle({ transform: 'translateY(112px)' });
  });

  it('keeps compact table row spacing on desktop (>=768px)', () => {
    stubMediaQuery('(max-width: 767px)', false);

    render(<TransactionHistory initialData={sampleTransactions} totalInitialCount={2} />);

    expect(screen.getByTestId('tx-row-1')).toHaveStyle({ transform: 'translateY(56px)' });
  });

  it('honours a custom mobile card height estimate', () => {
    stubMediaQuery('(max-width: 767px)', true);

    render(
      <TransactionHistory initialData={sampleTransactions} totalInitialCount={2} mobileRowHeight={140} />,
    );

    expect(screen.getByTestId('tx-row-1')).toHaveStyle({ transform: 'translateY(140px)' });
  });

  it('prevents horizontal scrolling inside the list on mobile', () => {
    stubMediaQuery('(max-width: 767px)', true);

    render(<TransactionHistory initialData={sampleTransactions} totalInitialCount={2} />);

    const container = screen.getByTestId('virtual-scroll-container');
    expect(container).toHaveClass('overflow-x-hidden');
    expect(container).toHaveClass('overflow-y-auto');
  });
});

export {};