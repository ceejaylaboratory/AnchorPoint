import { DynamicFeeService, RecommendedFee, FeeStats } from '../dynamic-fee.service';
import { redis } from '../../lib/redis';
import { stellarService } from '../stellar.service';

// Mock dependencies
jest.mock('../../lib/redis', () => ({
  redis: {
    get: jest.fn(),
    setEx: jest.fn(),
  },
}));

jest.mock('../stellar.service', () => ({
  stellarService: {
    getHorizonServer: jest.fn(),
  },
}));

jest.mock('../../config/env', () => ({
  config: {
    HORIZON_URL: 'https://horizon-testnet.stellar.org',
  },
}));

jest.mock('../../utils/logger', () => ({
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('DynamicFeeService', () => {
  let service: DynamicFeeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DynamicFeeService({
      cacheTtlSeconds: 10,
      maxFeeStroops: 10000,
      minFeeStroops: 100,
      normalPercentile: 50,
      urgentPercentile: 90,
    });
  });

  describe('getRecommendedFee', () => {
    it('should return default fee when Horizon is unavailable and no cache', async () => {
      // Mock Horizon failure
      (stellarService.getHorizonServer as jest.Mock).mockImplementation(() => {
        throw new Error('Network error');
      });
      (redis.get as jest.Mock).mockResolvedValue(null);

      const fee = await service.getRecommendedFee(false);

      expect(fee.source).toBe('default');
      expect(fee.fee).toBe(100); // Default minimum
      expect(fee.level).toBe('normal');
    });

    it('should return higher fee for urgent transactions', async () => {
      const mockFeeStats: FeeStats = {
        lastLedger: 100,
        lastLedgerBaseFeeInStroops: 100,
        feeChargedMax: 500,
        feeChargedMin: 100,
        feeChargedMode: 100,
        maxFeeMax: 1000,
        maxFeeMin: 100,
        maxFeeMode: 200,
        operationFeeStats: [
          { percentile: 'p50', max: 150, min: 100, mode: 100 },
          { percentile: 'p90', max: 500, min: 200, mode: 300 },
        ],
      };

      // Mock cached data
      (redis.get as jest.Mock).mockResolvedValue(
        JSON.stringify({ data: mockFeeStats, timestamp: Date.now() })
      );

      const normalFee = await service.getRecommendedFee(false);
      const urgentFee = await service.getRecommendedFee(true);

      expect(urgentFee.fee).toBeGreaterThanOrEqual(normalFee.fee);
      expect(urgentFee.level).toBe('high');
    });

    it('should apply fee cap to prevent unbounded fees', async () => {
      const mockFeeStats: FeeStats = {
        lastLedger: 100,
        lastLedgerBaseFeeInStroops: 100,
        feeChargedMax: 50000, // Very high
        feeChargedMin: 100,
        feeChargedMode: 100,
        maxFeeMax: 100000, // Very high
        maxFeeMin: 100,
        maxFeeMode: 200,
        operationFeeStats: [{ percentile: 'p90', max: 80000, min: 100, mode: 500 }],
      };

      (redis.get as jest.Mock).mockResolvedValue(
        JSON.stringify({ data: mockFeeStats, timestamp: Date.now() })
      );

      const fee = await service.getRecommendedFee(true);

      // Should be capped at maxFeeStroops (10000)
      expect(fee.fee).toBeLessThanOrEqual(10000);
    });
  });

  describe('getFeeStats', () => {
    it('should fetch fresh fee stats from Horizon', async () => {
      const mockFeeStats = {
        last_ledger: 100,
        last_ledger_base_fee_in_stroops: 100,
        fee_charged_max: 500,
        fee_charged_min: 100,
        fee_charged_mode: 100,
        max_fee_max: 1000,
        max_fee_min: 100,
        max_fee_mode: 200,
        operation_fee_stats: [
          { percentile: 'p50', max: 150, min: 100, mode: 100 },
        ],
      };

      const mockServer = {
        feeStats: jest.fn().mockReturnValue({
          call: jest.fn().mockResolvedValue(mockFeeStats),
        }),
      };
      (stellarService.getHorizonServer as jest.Mock).mockReturnValue(mockServer);

      // Force refresh to bypass cache
      const feeStats = await service.getFeeStats(true);

      expect(feeStats).not.toBeNull();
      expect(feeStats?.lastLedger).toBe(100);
      expect(redis.setEx).toHaveBeenCalled();
    });

    it('should return cached data when available and not forcing refresh', async () => {
      const cachedStats: FeeStats = {
        lastLedger: 99,
        lastLedgerBaseFeeInStroops: 100,
        feeChargedMax: 300,
        feeChargedMin: 100,
        feeChargedMode: 100,
        maxFeeMax: 500,
        maxFeeMin: 100,
        maxFeeMode: 200,
        operationFeeStats: [],
      };

      (redis.get as jest.Mock).mockResolvedValue(
        JSON.stringify({ data: cachedStats, timestamp: Date.now() })
      );

      const feeStats = await service.getFeeStats(false);

      expect(feeStats?.lastLedger).toBe(99);
      expect(stellarService.getHorizonServer).not.toHaveBeenCalled();
    });
  });

  describe('getTransactionFee', () => {
    it('should calculate total fee for multiple operations', async () => {
      const mockFeeStats: FeeStats = {
        lastLedger: 100,
        lastLedgerBaseFeeInStroops: 100,
        feeChargedMax: 200,
        feeChargedMin: 100,
        feeChargedMode: 100,
        maxFeeMax: 500,
        maxFeeMin: 100,
        maxFeeMode: 200,
        operationFeeStats: [{ percentile: 'p50', max: 150, min: 100, mode: 100 }],
      };

      (redis.get as jest.Mock).mockResolvedValue(
        JSON.stringify({ data: mockFeeStats, timestamp: Date.now() })
      );

      const result = await service.getTransactionFee(5, false);

      expect(result.totalFee).toBe(result.feePerOperation * 5);
      expect(result.feePerOperation).toBeGreaterThan(0);
    });
  });

  describe('fee level determination', () => {
    it('should return normal level for low fees', async () => {
      const mockFeeStats: FeeStats = {
        lastLedger: 100,
        lastLedgerBaseFeeInStroops: 100,
        feeChargedMax: 120,
        feeChargedMin: 100,
        feeChargedMode: 100,
        maxFeeMax: 200,
        maxFeeMin: 100,
        maxFeeMode: 150,
        operationFeeStats: [{ percentile: 'p50', max: 110, min: 100, mode: 100 }],
      };

      (redis.get as jest.Mock).mockResolvedValue(
        JSON.stringify({ data: mockFeeStats, timestamp: Date.now() })
      );

      const fee = await service.getRecommendedFee(false);

      expect(fee.level).toBe('normal');
      expect(fee.isSurge).toBe(false);
    });

    it('should return high level for surge fees', async () => {
      const mockFeeStats: FeeStats = {
        lastLedger: 100,
        lastLedgerBaseFeeInStroops: 100,
        feeChargedMax: 500,
        feeChargedMin: 100,
        feeChargedMode: 200,
        maxFeeMax: 1000,
        maxFeeMin: 100,
        maxFeeMode: 300,
        operationFeeStats: [{ percentile: 'p90', max: 400, min: 150, mode: 250 }],
      };

      (redis.get as jest.Mock).mockResolvedValue(
        JSON.stringify({ data: mockFeeStats, timestamp: Date.now() })
      );

      const fee = await service.getRecommendedFee(true);

      expect(['high', 'urgent']).toContain(fee.level);
    });
  });

  describe('surge detection', () => {
    it('should detect surge when fee is significantly higher than base', async () => {
      const mockFeeStats: FeeStats = {
        lastLedger: 100,
        lastLedgerBaseFeeInStroops: 100,
        feeChargedMax: 300,
        feeChargedMin: 100,
        feeChargedMode: 100,
        maxFeeMax: 500,
        maxFeeMin: 100,
        maxFeeMode: 200,
        operationFeeStats: [{ percentile: 'p90', max: 250, min: 100, mode: 150 }],
      };

      (redis.get as jest.Mock).mockResolvedValue(
        JSON.stringify({ data: mockFeeStats, timestamp: Date.now() })
      );

      const fee = await service.getRecommendedFee(true);

      // 250 / 100 = 2.5x, which is > 1.5, so isSurge should be true
      expect(fee.isSurge).toBe(true);
    });
  });
});

describe('DynamicFeeService configuration', () => {
  it('should use custom configuration', () => {
    const service = new DynamicFeeService({
      cacheTtlSeconds: 30,
      maxFeeStroops: 50000,
      minFeeStroops: 500,
    });

    expect(service).toBeDefined();
  });
});