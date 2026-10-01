/**
 * Unit tests for fx_analytics.service.ts
 *
 * Covers:
 *  - recordSnapshot: stores a snapshot and computes spread automatically
 *  - getHistory: returns aggregated history with stats (high/low/average/changePercent)
 *  - getHistory falls back to in-memory when DB is unavailable
 *  - getHistory returns empty result when no data exists for pair
 *  - spread is auto-computed from bid/ask
 */

import { FxAnalyticsService, RateSnapshot } from './fx_analytics.service';

// Mock prisma so tests run without a real database
jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    fxRateHistory: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import prisma from '../lib/prisma';
const mockPrisma = prisma as unknown as {
  fxRateHistory: {
    create: jest.Mock;
    findMany: jest.Mock;
  };
};

describe('FxAnalyticsService', () => {
  let service: FxAnalyticsService;

  beforeEach(() => {
    service = new FxAnalyticsService();
    service.clearMemoryStore();
    mockPrisma.fxRateHistory.create.mockReset();
    mockPrisma.fxRateHistory.findMany.mockReset();
  });

  // ── recordSnapshot ────────────────────────────────────────────────────────

  describe('recordSnapshot', () => {
    it('persists a snapshot to the database', async () => {
      mockPrisma.fxRateHistory.create.mockResolvedValue({});
      const snap: RateSnapshot = {
        sourceAsset: 'USDC',
        destinationAsset: 'XLM',
        rate: 8.5,
      };
      await service.recordSnapshot(snap);
      expect(mockPrisma.fxRateHistory.create).toHaveBeenCalledTimes(1);
      const { data } = mockPrisma.fxRateHistory.create.mock.calls[0][0];
      expect(data.sourceAsset).toBe('USDC');
      expect(data.destinationAsset).toBe('XLM');
      expect(data.rate).toBe(8.5);
    });

    it('auto-computes spread from bid and ask', async () => {
      mockPrisma.fxRateHistory.create.mockResolvedValue({});
      await service.recordSnapshot({
        sourceAsset: 'USDC',
        destinationAsset: 'XLM',
        rate: 8.5,
        bid: 8.4,
        ask: 8.6,
      });
      const { data } = mockPrisma.fxRateHistory.create.mock.calls[0][0];
      expect(data.spread).toBeCloseTo(0.2, 5);
    });

    it('stores null spread when bid/ask not provided', async () => {
      mockPrisma.fxRateHistory.create.mockResolvedValue({});
      await service.recordSnapshot({
        sourceAsset: 'BTC',
        destinationAsset: 'USDC',
        rate: 45000,
      });
      const { data } = mockPrisma.fxRateHistory.create.mock.calls[0][0];
      expect(data.spread).toBeNull();
    });

    it('falls back to in-memory when DB throws', async () => {
      mockPrisma.fxRateHistory.create.mockRejectedValue(new Error('DB unavailable'));
      // Should not throw
      await expect(
        service.recordSnapshot({ sourceAsset: 'USDC', destinationAsset: 'XLM', rate: 8.5 })
      ).resolves.toBeUndefined();
    });
  });

  // ── getHistory ────────────────────────────────────────────────────────────

  describe('getHistory', () => {
    const now = Date.now();

    function makeRow(rate: number, offsetMinutes: number) {
      return {
        rate,
        spread: 0.01,
        recordedAt: new Date(now - offsetMinutes * 60 * 1000),
      };
    }

    it('returns data from the database when available', async () => {
      mockPrisma.fxRateHistory.findMany.mockResolvedValue([
        makeRow(8.0, 60),
        makeRow(8.5, 30),
        makeRow(9.0, 0),
      ]);
      const result = await service.getHistory('USDC', 'XLM', 24);
      expect(result.sourceAsset).toBe('USDC');
      expect(result.destinationAsset).toBe('XLM');
      expect(result.points).toHaveLength(3);
      expect(result.high).toBeCloseTo(9.0, 5);
      expect(result.low).toBeCloseTo(8.0, 5);
      expect(result.average).toBeCloseTo(8.5, 5);
      // price increased → positive change
      expect(result.changePercent).toBeGreaterThan(0);
    });

    it('falls back to in-memory when DB returns no rows', async () => {
      mockPrisma.fxRateHistory.findMany.mockResolvedValue([]);
      // Pre-populate in-memory
      mockPrisma.fxRateHistory.create.mockResolvedValue({});
      await service.recordSnapshot({ sourceAsset: 'ETH', destinationAsset: 'USDC', rate: 2500 });
      const result = await service.getHistory('ETH', 'USDC', 24);
      expect(result.points.length).toBeGreaterThan(0);
      expect(result.points[0].rate).toBe(2500);
    });

    it('falls back to in-memory when DB throws', async () => {
      mockPrisma.fxRateHistory.findMany.mockRejectedValue(new Error('DB down'));
      mockPrisma.fxRateHistory.create.mockResolvedValue({});
      await service.recordSnapshot({ sourceAsset: 'XLM', destinationAsset: 'USDC', rate: 0.12 });
      const result = await service.getHistory('XLM', 'USDC', 24);
      expect(result.points.length).toBeGreaterThan(0);
    });

    it('returns empty result for a pair with no history', async () => {
      mockPrisma.fxRateHistory.findMany.mockResolvedValue([]);
      const result = await service.getHistory('BTC', 'ETH', 24);
      expect(result.points).toHaveLength(0);
      expect(result.high).toBe(0);
      expect(result.low).toBe(0);
    });

    it('computes changePercent correctly', async () => {
      mockPrisma.fxRateHistory.findMany.mockResolvedValue([
        makeRow(10.0, 120),
        makeRow(12.0, 0),
      ]);
      const result = await service.getHistory('USDC', 'XLM', 24);
      // (12-10)/10 * 100 = 20%
      expect(result.changePercent).toBeCloseTo(20, 2);
    });

    it('normalises asset codes to uppercase', async () => {
      mockPrisma.fxRateHistory.findMany.mockResolvedValue([]);
      const result = await service.getHistory('usdc', 'xlm');
      expect(result.sourceAsset).toBe('USDC');
      expect(result.destinationAsset).toBe('XLM');
    });
  });
});
