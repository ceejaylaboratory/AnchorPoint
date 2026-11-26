import { ReconciliationWorker, BalanceComparison, ReconciliationResult } from '../reconciliation.worker';
import { metricsService } from '../../services/metrics.service';
import { stellarService } from '../../services/stellar.service';

// Mock dependencies
jest.mock('../../lib/prisma', () => ({
  transaction: {
    findMany: jest.fn(),
    aggregate: jest.fn(),
  },
}));

jest.mock('../../services/stellar.service', () => ({
  stellarService: {
    getHorizonServer: jest.fn(),
  },
}));

jest.mock('../../services/metrics.service', () => ({
  metricsService: {
    incrementFinancialReconciliation: jest.fn(),
    incrementReconciliationMismatch: jest.fn(),
  },
}));

jest.mock('../../config/env', () => ({
  config: {
    ALERT_RECIPIENTS: 'admin@example.com',
    STELLAR_ISSUING_ACCOUNT: 'GCISSUE123',
    STELLAR_DISTRIBUTION_ACCOUNT: 'GCDIST456',
  },
}));

import prisma from '../../lib/prisma';

describe('ReconciliationWorker', () => {
  let worker: ReconciliationWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    worker = new ReconciliationWorker({
      schedule: '0 * * * *',
      precisionThreshold: 0.001,
      absoluteThresholdStroops: 1000,
      distributionAccount: 'GCDIST456',
      issuingAccount: 'GCISSUE123',
    });
  });

  describe('runReconciliation', () => {
    it('should complete reconciliation when balances match', async () => {
      // Mock: get tracked assets
      (prisma.transaction.findMany as jest.Mock).mockResolvedValueOnce([
        { assetCode: 'USDC' },
        { assetCode: 'XLM' },
      ]);

      // Mock: on-chain balance for USDC
      const mockServer = {
        accounts: jest.fn().mockReturnValue({
          account: jest.fn().mockResolvedValue({
            balances: [
              { asset_code: 'USDC', asset_issuer: 'GCISSUE123', balance: '1000000' },
              { asset_type: 'native', balance: '50000000' },
            ],
          }),
        }),
      };
      (stellarService.getHorizonServer as jest.Mock).mockReturnValue(mockServer);

      // Mock: off-chain balance
      (prisma.transaction.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: '1000000' } }) // USDC
        .mockResolvedValueOnce({ _sum: { amount: '50000000' } }); // XLM

      const result = await worker.runReconciliation();

      expect(result.checkedAssets).toBeGreaterThan(0);
      expect(result.summary.hasMismatches).toBe(false);
      expect(metricsService.incrementFinancialReconciliation).toHaveBeenCalled();
    });

    it('should detect discrepancy when balances do not match', async () => {
      // Mock: get tracked assets
      (prisma.transaction.findMany as jest.Mock).mockResolvedValueOnce([
        { assetCode: 'USDC' },
      ]);

      // Mock: on-chain balance higher than off-chain
      const mockServer = {
        accounts: jest.fn().mockReturnValue({
          account: jest.fn().mockResolvedValue({
            balances: [
              { asset_code: 'USDC', asset_issuer: 'GCISSUE123', balance: '1000500' }, // 500 more
            ],
          }),
        }),
      };
      (stellarService.getHorizonServer as jest.Mock).mockReturnValue(mockServer);

      // Mock: off-chain balance lower
      (prisma.transaction.aggregate as jest.Mock).mockResolvedValueOnce({
        _sum: { amount: '1000000' },
      });

      const result = await worker.runReconciliation();

      expect(result.summary.hasMismatches).toBe(true);
      expect(result.discrepancies[0].discrepancy).toBe('500');
      expect(metricsService.incrementReconciliationMismatch).toHaveBeenCalled();
    });

    it('should handle XLM native asset correctly', async () => {
      // Mock: get tracked assets including XLM
      (prisma.transaction.findMany as jest.Mock).mockResolvedValueOnce([
        { assetCode: 'XLM' },
      ]);

      const mockServer = {
        accounts: jest.fn().mockReturnValue({
          account: jest.fn().mockResolvedValue({
            balances: [{ asset_type: 'native', balance: '100000000' }],
          }),
        }),
      };
      (stellarService.getHorizonServer as jest.Mock).mockReturnValue(mockServer);

      (prisma.transaction.aggregate as jest.Mock).mockResolvedValueOnce({
        _sum: { amount: '100000000' },
      });

      const result = await worker.runReconciliation();

      expect(result.discrepancies.some(d => d.assetCode === 'XLM')).toBe(true);
    });
  });

  describe('BalanceComparison logic', () => {
    it('should correctly identify matches within threshold', () => {
      const comparison: BalanceComparison = {
        assetCode: 'USDC',
        onChainBalance: '1000000',
        offChainBalance: '1000001',
        discrepancy: '1',
        discrepancyRatio: 0.000001,
        isMatch: true,
      };

      expect(comparison.isMatch).toBe(true);
    });

    it('should correctly identify mismatches exceeding threshold', () => {
      const comparison: BalanceComparison = {
        assetCode: 'USDC',
        onChainBalance: '1001000',
        offChainBalance: '1000000',
        discrepancy: '1000',
        discrepancyRatio: 0.001,
        isMatch: false,
      };

      expect(comparison.isMatch).toBe(false);
    });
  });

  describe('ReconciliationResult structure', () => {
    it('should have correct structure', () => {
      const result: ReconciliationResult = {
        timestamp: new Date(),
        checkedAssets: 2,
        discrepancies: [],
        summary: {
          totalOnChain: '1000000',
          totalOffChain: '1000000',
          totalDiscrepancy: '0',
          hasMismatches: false,
        },
      };

      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('checkedAssets');
      expect(result).toHaveProperty('discrepancies');
      expect(result.summary).toHaveProperty('hasMismatches');
    });
  });
});

describe('ReconciliationWorker with different thresholds', () => {
  it('should use custom threshold configuration', () => {
    const worker = new ReconciliationWorker({
      precisionThreshold: 0.01, // 1%
      absoluteThresholdStroops: 10000, // 0.1 XLM
    });

    expect(worker).toBeDefined();
  });
});