import { FeeService, computeAssetFee } from './fee.service';
import { RedisService } from './redis.service';
import type { AssetConfig } from '../config/assets';

// p95/p50 ratio = 1.5 (< 2.0 threshold), capacity 50% → no surge
const mockHorizonStats = {
  fee_charged: {
    min: '100', max: '500', mode: '100',
    p10: '100', p20: '100', p30: '100', p40: '150',
    p50: '200', p60: '220', p70: '250', p80: '270',
    p90: '280', p95: '300', p99: '400',
  },
  ledger_capacity_usage: '0.5',
};

const surgeMockStats = {
  ...mockHorizonStats,
  fee_charged: { ...mockHorizonStats.fee_charged, p50: '100', p95: '500' },
  ledger_capacity_usage: '0.85',
};

function makeRedisService(cached: unknown = null): RedisService {
  const client = {
    get: jest.fn().mockResolvedValue(cached ? JSON.stringify(cached) : null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(undefined),
  };
  return new RedisService(client);
}

global.fetch = jest.fn();

describe('FeeService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns cached stats without hitting Horizon', async () => {
    const cachedStats = { surgeActive: false, recommendedFeeStroops: 200, fetchedAt: new Date().toISOString() };
    const service = new FeeService(makeRedisService(cachedStats));
    const stats = await service.getFeeStats();
    expect(stats.recommendedFeeStroops).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches from Horizon on cache miss and detects no surge', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => mockHorizonStats });
    const service = new FeeService(makeRedisService(null));
    const stats = await service.getFeeStats();
    expect(stats.surgeActive).toBe(false);
    expect(stats.surgeMultiplier).toBe(1.0);
    expect(stats.recommendedFeeStroops).toBe(200); // p50 when no surge
  });

  it('detects surge when capacity > 80% and p95/p50 ratio is high', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => surgeMockStats });
    const service = new FeeService(makeRedisService(null));
    const stats = await service.getFeeStats();
    expect(stats.surgeActive).toBe(true);
    expect(stats.surgeMultiplier).toBeGreaterThan(1.0);
    expect(stats.recommendedFeeStroops).toBeGreaterThan(stats.p50FeeStroops);
  });

  it('caps surge multiplier at 5x', async () => {
    const extremeStats = {
      ...mockHorizonStats,
      fee_charged: { ...mockHorizonStats.fee_charged, p50: '100', p95: '10000' },
      ledger_capacity_usage: '1.0',
    };
    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => extremeStats });
    const service = new FeeService(makeRedisService(null));
    const stats = await service.getFeeStats();
    expect(stats.surgeMultiplier).toBeLessThanOrEqual(5.0);
  });

  it('estimateFee multiplies recommended fee by operation count', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => mockHorizonStats });
    const service = new FeeService(makeRedisService(null));
    const estimate = await service.estimateFee(3);
    expect(estimate.operationCount).toBe(3);
    // recommended = p50 (200) when no surge; total = 200 * 3
    expect(estimate.estimatedFeeStroops).toBe(600);
  });

  it('throws when Horizon returns non-ok status', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 });
    const service = new FeeService(makeRedisService(null));
    await expect(service.getFeeStats()).rejects.toThrow('503');
  });
});

// ─── Asset-specific fee calculation ───────────────────────────────────────────

function makeAsset(overrides: Partial<AssetConfig>): AssetConfig {
  return {
    code: 'TEST',
    issuers: {},
    type: 'crypto',
    desc: 'test asset',
    minAmount: '0',
    maxAmount: '1000000',
    feeType: 'tiered',
    feeFixed: 0,
    feePercent: 0,
    feeMinimum: 0,
    depositEnabled: true,
    withdrawEnabled: true,
    ...overrides,
  };
}

describe('computeAssetFee', () => {
  it('flat: charges only feeFixed regardless of amount', () => {
    const asset = makeAsset({ feeType: 'flat', feeFixed: 1.5 });
    expect(computeAssetFee(asset, 0)).toBe(1.5);
    expect(computeAssetFee(asset, 100)).toBe(1.5);
    expect(computeAssetFee(asset, 999999)).toBe(1.5);
  });

  it('percentage: charges amount * feePercent', () => {
    const asset = makeAsset({ feeType: 'percentage', feePercent: 0.01 });
    expect(computeAssetFee(asset, 100)).toBe(1);
    expect(computeAssetFee(asset, 1000)).toBe(10);
  });

  it('percentage: enforces feeMinimum', () => {
    const asset = makeAsset({ feeType: 'percentage', feePercent: 0.001, feeMinimum: 0.5 });
    // 10 * 0.001 = 0.01, which is below the 0.5 minimum
    expect(computeAssetFee(asset, 10)).toBe(0.5);
    // 1000 * 0.001 = 1.0, which is above the 0.5 minimum
    expect(computeAssetFee(asset, 1000)).toBe(1);
  });

  it('tiered: charges feeFixed + amount * feePercent', () => {
    const asset = makeAsset({ feeType: 'tiered', feeFixed: 0.5, feePercent: 0.005 });
    // 0.5 + (100 * 0.005) = 0.5 + 0.5 = 1.0
    expect(computeAssetFee(asset, 100)).toBe(1);
    // 0.5 + (1000 * 0.005) = 0.5 + 5 = 5.5
    expect(computeAssetFee(asset, 1000)).toBe(5.5);
  });

  it('tiered: enforces feeMinimum', () => {
    const asset = makeAsset({ feeType: 'tiered', feeFixed: 0.01, feePercent: 0.001, feeMinimum: 1.0 });
    // 0.01 + (5 * 0.001) = 0.015, below 1.0 minimum
    expect(computeAssetFee(asset, 5)).toBe(1.0);
  });

  it('returns 0 when all fee fields are 0', () => {
    const asset = makeAsset({ feeType: 'percentage', feePercent: 0 });
    expect(computeAssetFee(asset, 100)).toBe(0);
  });
});

describe('FeeService.calculateAssetFee', () => {
  const service = new FeeService(makeRedisService(null));

  it('returns correct result for a known asset (USDC / flat)', () => {
    const result = service.calculateAssetFee('USDC', 500);
    expect(result.assetCode).toBe('USDC');
    expect(result.feeType).toBe('flat');
    expect(result.inputAmount).toBe(500);
    expect(result.feeAmount).toBe(0.5); // flat $0.50
  });

  it('returns correct result for a known asset (USD / tiered)', () => {
    const result = service.calculateAssetFee('USD', 1000);
    expect(result.assetCode).toBe('USD');
    expect(result.feeType).toBe('tiered');
    // 0.5 + (1000 * 0.005) = 5.5
    expect(result.feeAmount).toBe(5.5);
  });

  it('is case-insensitive for asset codes', () => {
    const result = service.calculateAssetFee('usdc', 100);
    expect(result.assetCode).toBe('USDC');
  });

  it('throws for unknown asset codes', () => {
    expect(() => service.calculateAssetFee('NOPE', 100)).toThrow('Unknown asset: NOPE');
  });
});
