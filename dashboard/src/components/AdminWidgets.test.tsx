import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { 
  AdminWidgets, 
  computeHealthFactor, 
  sortVaultsByHealthFactor, 
  VaultRecord 
} from './AdminWidgets';

describe('AdminWidgets - Liquidation Vaults Health Factor Monitoring', () => {
  const sampleVaults: VaultRecord[] = [
    {
      id: 'VAULT-1',
      borrower: 'GBB1...1111',
      collateralAsset: 'XLM',
      collateralAmount: 10000,
      collateralPrice: 0.1, // Collateral value: 1000
      debtAsset: 'USDC',
      debtAmount: 850,
      debtPrice: 1.0, // Debt value: 850
      liquidationThreshold: 0.8, // (1000 * 0.8) / 850 = 0.9412 (< 1.1 - Undercollateralized)
    },
    {
      id: 'VAULT-2',
      borrower: 'GBB2...2222',
      collateralAsset: 'USDC',
      collateralAmount: 5000,
      collateralPrice: 1.0, // Collateral value: 5000
      debtAsset: 'USDC',
      debtAmount: 2000,
      debtPrice: 1.0, // Debt value: 2000
      liquidationThreshold: 0.8, // (5000 * 0.8) / 2000 = 2.0 (Healthy)
    },
    {
      id: 'VAULT-3',
      borrower: 'GBB3...3333',
      collateralAsset: 'XLM',
      collateralAmount: 20000,
      collateralPrice: 0.1, // Collateral value: 2000
      debtAsset: 'USDC',
      debtAmount: 1300,
      debtPrice: 1.0, // Debt value: 1300
      liquidationThreshold: 0.8, // (2000 * 0.8) / 1300 = 1.2308 (At Risk)
    }
  ];

  describe('computeHealthFactor', () => {
    it('accurately computes Health Factor with liquidation threshold', () => {
      // (10000 * 0.1 * 0.8) / (850 * 1.0) = 800 / 850 = 0.9412
      const hf = computeHealthFactor(10000, 0.1, 850, 1.0, 0.8);
      expect(hf).toBe(0.9412);
    });

    it('returns Infinity when debt is zero', () => {
      const hf = computeHealthFactor(5000, 1.0, 0, 1.0, 0.8);
      expect(hf).toBe(Infinity);
    });

    it('returns 0 when collateral is zero', () => {
      const hf = computeHealthFactor(0, 1.0, 1000, 1.0, 0.8);
      expect(hf).toBe(0);
    });
  });

  describe('sortVaultsByHealthFactor', () => {
    it('sorts vaults by Health Factor ascending (lowest HF first)', () => {
      const sorted = sortVaultsByHealthFactor(sampleVaults, 'asc');
      expect(sorted[0].id).toBe('VAULT-1'); // HF ~ 0.94
      expect(sorted[1].id).toBe('VAULT-3'); // HF ~ 1.23
      expect(sorted[2].id).toBe('VAULT-2'); // HF ~ 2.00
    });

    it('sorts vaults by Health Factor descending (highest HF first)', () => {
      const sorted = sortVaultsByHealthFactor(sampleVaults, 'desc');
      expect(sorted[0].id).toBe('VAULT-2'); // HF ~ 2.00
      expect(sorted[1].id).toBe('VAULT-3'); // HF ~ 1.23
      expect(sorted[2].id).toBe('VAULT-1'); // HF ~ 0.94
    });
  });

  describe('AdminWidgets component rendering and interactions', () => {
    it('highlights vaults with Health Factor < 1.1 in red with Liquidatable status', () => {
      render(<AdminWidgets initialVaults={sampleVaults} isLiquidatorConnected={true} />);

      // VAULT-1 has HF < 1.1, should show Liquidatable badge
      const badge = screen.getByTestId('status-badge-VAULT-1');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent(/liquidatable/i);

      // Check row highlighting
      const row = screen.getByTestId('vault-row-VAULT-1');
      expect(row.className).toContain('border-l-rose-500');

      // Health factor text should be red
      const hfElement = screen.getByTestId('health-factor-VAULT-1');
      expect(hfElement.className).toContain('text-rose-400');
    });

    it('displays the correct under-collateralized count', () => {
      render(<AdminWidgets initialVaults={sampleVaults} isLiquidatorConnected={true} />);
      const countElement = screen.getByTestId('under-collateralized-count');
      expect(countElement).toHaveTextContent('1');
    });

    it('allows sorting table by clicking Health Factor header', () => {
      render(<AdminWidgets initialVaults={sampleVaults} isLiquidatorConnected={true} />);

      // Initially sorted ascending (VAULT-1, VAULT-3, VAULT-2)
      const rowsBefore = screen.getAllByTestId(/^vault-row-/);
      expect(rowsBefore[0]).toHaveAttribute('data-testid', 'vault-row-VAULT-1');

      // Click sort header to sort descending
      const sortHeader = screen.getByTestId('sort-health-factor');
      fireEvent.click(sortHeader);

      const rowsAfter = screen.getAllByTestId(/^vault-row-/);
      expect(rowsAfter[0]).toHaveAttribute('data-testid', 'vault-row-VAULT-2');
      expect(rowsAfter[2]).toHaveAttribute('data-testid', 'vault-row-VAULT-1');
    });

    it('filters only under-collateralized vaults when filter tab is clicked', () => {
      render(<AdminWidgets initialVaults={sampleVaults} isLiquidatorConnected={true} />);

      const filterBtn = screen.getByTestId('filter-undercollateralized');
      fireEvent.click(filterBtn);

      const rows = screen.getAllByTestId(/^vault-row-/);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveAttribute('data-testid', 'vault-row-VAULT-1');
    });

    it('enables Trigger Liquidation button for under-collateralized vaults and executes liquidation', async () => {
      const handleLiquidate = vi.fn().mockResolvedValue(undefined);
      render(
        <AdminWidgets 
          initialVaults={sampleVaults} 
          isLiquidatorConnected={true} 
          onLiquidateVault={handleLiquidate} 
        />
      );

      const triggerBtn = screen.getByTestId('trigger-liquidation-VAULT-1');
      expect(triggerBtn).toBeInTheDocument();
      expect(triggerBtn).not.toBeDisabled();

      fireEvent.click(triggerBtn);

      await waitFor(() => {
        expect(handleLiquidate).toHaveBeenCalledWith('VAULT-1');
      });
    });
  });
});
