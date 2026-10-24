import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { 
  TransactionHistory, 
  generateTransactions 
} from './TransactionHistory';

describe('TransactionHistory - Virtualized Transaction History Table for 10,000+ Records', () => {
  describe('generateTransactions generator', () => {
    it('generates the exact requested number of transaction records', () => {
      const txs = generateTransactions(50);
      expect(txs).toHaveLength(50);
      expect(txs[0]).toHaveProperty('id');
      expect(txs[0]).toHaveProperty('hash');
      expect(txs[0]).toHaveProperty('type');
      expect(txs[0]).toHaveProperty('amount');
      expect(txs[0]).toHaveProperty('status');
      expect(txs[0]).toHaveProperty('counterparty');
    });

    it('generates 10,000 records efficiently without memory issues', () => {
      const txs = generateTransactions(10000);
      expect(txs).toHaveLength(10000);
      expect(txs[0].id).toBe('TX-10000');
      expect(txs[9999].id).toBe('TX-1');
    });
  });

  describe('TransactionHistory virtualization and rendering', () => {
    it('renders the virtualized table container and header', () => {
      render(<TransactionHistory totalInitialCount={100} />);

      expect(screen.getByTestId('virtualized-tx-history')).toBeInTheDocument();
      expect(screen.getByTestId('virtual-scroll-container')).toBeInTheDocument();
      expect(screen.getByText(/60 FPS Virtualized/i)).toBeInTheDocument();
    });

    it('computes total virtualizer container size based on row count and row height', () => {
      // 100 rows * 56px = 5600px
      render(<TransactionHistory totalInitialCount={100} rowHeight={56} />);

      const innerContainer = screen.getByTestId('virtual-inner-container');
      expect(innerContainer).toHaveStyle({ height: '5600px' });
    });

    it('verifies DOM node count is bounded and does NOT create 10,000 DOM rows', () => {
      render(<TransactionHistory totalInitialCount={10000} rowHeight={56} />);

      // The virtual inner container calculates height for 10,000 items (10000 * 56 = 560000px)
      const innerContainer = screen.getByTestId('virtual-inner-container');
      expect(innerContainer).toHaveStyle({ height: '560000px' });

      // All rendered transaction rows in the DOM should be bounded (not 10,000)
      const renderedRows = screen.queryAllByTestId(/^tx-row-/);
      expect(renderedRows.length).toBeLessThan(100);
    });

    it('filters transactions when typing in search query', () => {
      const sampleTxs = [
        {
          id: 'TX-UNIQUE-123',
          hash: '0xabc123',
          type: 'Deposit' as const,
          asset: 'USDC',
          amount: '100.00',
          counterparty: 'GDEMO1',
          status: 'Completed' as const,
          date: '2024-03-20',
          timestamp: 1710500000,
          fee: '0.00001 XLM'
        },
        {
          id: 'TX-OTHER-999',
          hash: '0xdef456',
          type: 'Withdrawal' as const,
          asset: 'XLM',
          amount: '50.00',
          counterparty: 'GDEMO2',
          status: 'Pending' as const,
          date: '2024-03-21',
          timestamp: 1710500100,
          fee: '0.00001 XLM'
        }
      ];

      render(<TransactionHistory initialData={sampleTxs} totalInitialCount={2} />);

      const searchInput = screen.getByTestId('tx-search-input');
      fireEvent.change(searchInput, { target: { value: 'UNIQUE-123' } });

      const innerContainer = screen.getByTestId('virtual-inner-container');
      // Only 1 item matches: 1 * 56 = 56px
      expect(innerContainer).toHaveStyle({ height: '56px' });
    });

    it('filters transactions by type dropdown', () => {
      const sampleTxs = [
        {
          id: 'TX-1',
          hash: '0x1',
          type: 'Deposit' as const,
          asset: 'USDC',
          amount: '100.00',
          counterparty: 'G1',
          status: 'Completed' as const,
          date: '2024-03-20',
          timestamp: 1710500000,
          fee: '0.00001 XLM'
        },
        {
          id: 'TX-2',
          hash: '0x2',
          type: 'Withdrawal' as const,
          asset: 'USDC',
          amount: '50.00',
          counterparty: 'G2',
          status: 'Completed' as const,
          date: '2024-03-21',
          timestamp: 1710500100,
          fee: '0.00001 XLM'
        }
      ];

      render(<TransactionHistory initialData={sampleTxs} totalInitialCount={2} />);

      const typeFilter = screen.getByTestId('tx-type-filter');
      fireEvent.change(typeFilter, { target: { value: 'Withdrawal' } });

      const innerContainer = screen.getByTestId('virtual-inner-container');
      // Only Withdrawal matches: 1 * 56 = 56px
      expect(innerContainer).toHaveStyle({ height: '56px' });
    });
  });

  describe('mobile-responsive card layout and expand/collapse', () => {
    const sampleTxs = [
      {
        id: 'TX-MOBILE-1',
        hash: '0x1234567890abcdef',
        type: 'Deposit' as const,
        asset: 'USDC',
        amount: '250.00',
        counterparty: 'GABC...1234',
        status: 'Completed' as const,
        date: '2024-03-22',
        timestamp: 1710500000,
        fee: '0.00001 XLM'
      }
    ];

    it('renders key fields on mobile card and hides secondary fields by default', () => {
      render(<TransactionHistory initialData={sampleTxs} totalInitialCount={1} />);

      // Mobile card should be rendered
      expect(screen.getByTestId('tx-card-0')).toBeInTheDocument();

      // Key fields visible without horizontal scrolling
      expect(screen.getByTestId('tx-card-status-0')).toHaveTextContent('Completed');
      expect(screen.getByTestId('tx-card-amount-0')).toHaveTextContent('+250.00 USDC');
      expect(screen.getByTestId('tx-card-date-0')).toHaveTextContent('2024-03-22');

      // Secondary fields collapsed
      expect(screen.queryByTestId('tx-card-secondary-0')).not.toBeInTheDocument();
    });

    it('toggles secondary fields when clicking expand/collapse button', () => {
      render(<TransactionHistory initialData={sampleTxs} totalInitialCount={1} />);

      const toggleBtn = screen.getByTestId('tx-card-expand-btn-0');
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

      // Expand secondary fields
      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
      const secondaryDetails = screen.getByTestId('tx-card-secondary-0');
      expect(secondaryDetails).toBeInTheDocument();
      expect(within(secondaryDetails).getByText('TX-MOBILE-1')).toBeInTheDocument();
      expect(within(secondaryDetails).getByText('0x1234567890abcdef')).toBeInTheDocument();
      expect(within(secondaryDetails).getByText('GABC...1234')).toBeInTheDocument();
      expect(within(secondaryDetails).getByText('0.00001 XLM')).toBeInTheDocument();

      // Collapse secondary fields
      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('tx-card-secondary-0')).not.toBeInTheDocument();
    });
  });

  describe('Real-time updates and animation', () => {
    it('animates row briefly when transaction status update is received', async () => {
      const sampleTxs = [
        {
          id: 'TX-ANIM-1',
          hash: '0x123',
          type: 'Deposit' as const,
          asset: 'USDC',
          amount: '100.00',
          counterparty: 'GABC',
          status: 'Pending' as const,
          date: '2024-03-21',
          timestamp: 1710500000,
          fee: '0.00001 XLM'
        }
      ];

      render(<TransactionHistory initialData={sampleTxs} totalInitialCount={1} />);

      const row = screen.getByTestId('tx-row-0');
      expect(row).not.toHaveAttribute('data-animating');

      // Trigger store status update
      const { useTransactionStore } = await import('../store/transactionStore');
      const { act } = await import('@testing-library/react');
      await act(async () => {
        useTransactionStore.getState().applyStatusUpdate({
          id: 'TX-ANIM-1',
          status: 'COMPLETED'
        });
      });

      // Row now has animating attribute and animation class
      const updatedRow = screen.getByTestId('tx-row-0');
      expect(updatedRow).toHaveAttribute('data-animating', 'true');
      expect(updatedRow.className).toContain('animate-pulse');
    });

    it('renders the connection mode badge', () => {
      render(<TransactionHistory totalInitialCount={10} />);
      const badge = screen.getByTestId('connection-mode-badge');
      expect(badge).toBeInTheDocument();
    });
  });
});


