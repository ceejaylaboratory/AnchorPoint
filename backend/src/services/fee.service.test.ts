import { FeeService, computeAssetFee } from './fee.service';
import { RedisService } from './redis.service';
import type { AssetConfig } from '../config/assets';
import prisma from '../lib/prisma';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    feeSchedule: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

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
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.feeSchedule.findFirst as jest.Mock).mockResolvedValue(null);
  });

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

  it('tiered: preserves precision for fractional amounts', () => {
    const asset = makeAsset({ feeType: 'tiered', feeFixed: 0.1, feePercent: 0.005 });
    expect(computeAssetFee(asset, '0.3')).toBe(0.1015);
  });

  it('returns 0 when all fee fields are 0', () => {
    const asset = makeAsset({ feeType: 'percentage', feePercent: 0 });
    expect(computeAssetFee(asset, 100)).toBe(0);
  });
});

describe('FeeService.calculateAssetFee', () => {
  const service = new FeeService(makeRedisService(null));

  beforeEach(() => {
    (prisma.feeSchedule.findFirst as jest.Mock).mockResolvedValue(null);
  });

  it('returns correct result for a known asset (USDC / flat)', async () => {
    const result = await service.calculateAssetFee('USDC', 500);
    expect(result.assetCode).toBe('USDC');
    expect(result.feeType).toBe('flat');
    expect(result.inputAmount).toBe(500);
    expect(result.feeAmount).toBe(0.5); // flat $0.50
  });

  it('returns correct result for a known asset (USD / tiered)', async () => {
    const result = await service.calculateAssetFee('USD', 1000);
    expect(result.assetCode).toBe('USD');
    expect(result.feeType).toBe('tiered');
    // 0.5 + (1000 * 0.005) = 5.5
    expect(result.feeAmount).toBe(5.5);
  });

  it('is case-insensitive for asset codes', async () => {
    const result = await service.calculateAssetFee('usdc', 100);
    expect(result.assetCode).toBe('USDC');
  });

  it('throws for unknown asset codes', async () => {
    await expect(service.calculateAssetFee('NOPE', 100)).rejects.toThrow('Unknown asset: NOPE');
  });

  it('synchronously calculates fee using calculateAssetFeeSync', () => {
    const result = service.calculateAssetFeeSync('USDC', 200);
    expect(result.assetCode).toBe('USDC');
    expect(result.feeAmount).toBe(0.5);
  });
});

// ─── Versioned fee schedule tests (#1348) ──────────────────────────────────────

describe('FeeService.versionedFeeSchedules', () => {
  const service = new FeeService(makeRedisService(null));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the fee schedule version active at the transaction createdAt timestamp', async () => {
    const olderSchedule = {
      id: 'sched-1',
      assetCode: 'USDC',
      feeType: 'flat',
      feeFixed: 0.25,
      feePercent: 0,
      feeMinimum: 0,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    };

    (prisma.feeSchedule.findFirst as jest.Mock).mockResolvedValue(olderSchedule);

    // Transaction created back in February 2026
    const txCreatedAt = new Date('2026-02-15T12:00:00Z');
    const result = await service.calculateAssetFee('USDC', 100, txCreatedAt);

    expect(prisma.feeSchedule.findFirst).toHaveBeenCalledWith({
      where: {
        assetCode: 'USDC',
        effectiveFrom: { lte: txCreatedAt },
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    expect(result.feeAmount).toBe(0.25);
    expect(result.scheduleId).toBe('sched-1');
  });

  it('getFeeForTransaction queries active schedule based on tx.createdAt', async () => {
    const activeSchedule = {
      id: 'sched-2',
      assetCode: 'USD',
      feeType: 'percentage',
      feeFixed: 0,
      feePercent: 0.02,
      feeMinimum: 1.0,
      effectiveFrom: new Date('2026-06-01T00:00:00Z'),
    };

    (prisma.feeSchedule.findFirst as jest.Mock).mockResolvedValue(activeSchedule);

    const tx = {
      assetCode: 'USD',
      amount: '500',
      createdAt: new Date('2026-07-01T00:00:00Z'),
    };

    const result = await service.getFeeForTransaction(tx);
    // 500 * 0.02 = 10
    expect(result.feeAmount).toBe(10);
    expect(result.scheduleId).toBe('sched-2');
  });

  it('addFeeSchedule creates a new schedule when effective date is in the future', async () => {
    const futureDate = new Date(Date.now() + 86400 * 1000 * 7); // 7 days in future
    const createdSchedule = {
      id: 'sched-future',
      assetCode: 'USDC',
      feeType: 'flat',
      feeFixed: 1.0,
      feePercent: 0,
      feeMinimum: 0,
      effectiveFrom: futureDate,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (prisma.feeSchedule.create as jest.Mock).mockResolvedValue(createdSchedule);

    const result = await service.addFeeSchedule({
      assetCode: 'usdc',
      feeType: 'flat',
      feeFixed: 1.0,
      effectiveFrom: futureDate,
    });

    expect(result.id).toBe('sched-future');
    expect(prisma.feeSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assetCode: 'USDC',
        feeType: 'flat',
        feeFixed: 1.0,
        effectiveFrom: futureDate,
      }),
    });
  });

  it('addFeeSchedule rejects effective dates in the past', async () => {
    const pastDate = new Date(Date.now() - 86400 * 1000); // 1 day ago

    await expect(
      service.addFeeSchedule({
        assetCode: 'USDC',
        feeType: 'flat',
        feeFixed: 1.0,
        effectiveFrom: pastDate,
      })
    ).rejects.toThrow('effectiveFrom must be a future date');
  });

  it('falls back to static asset config if no DB record exists', async () => {
    (prisma.feeSchedule.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await service.calculateAssetFee('USDC', 100);
    expect(result.feeAmount).toBe(0.5); // static USDC feeFixed
    expect(result.scheduleId).toBeUndefined();
  });
});

// ─── SEP-24 itemized fee calculation ──────────────────────────────────────────

describe('FeeService.calculateSep24Fee', () => {
  const service = new FeeService(makeRedisService(null));

  it('applies 1 % tier for amounts below 1 000', () => {
    const result = service.calculateSep24Fee('USDC', 'deposit', 100);
    expect(result.assetCode).toBe('USDC');
    expect(result.operation).toBe('deposit');
    expect(result.inputAmount).toBe(100);
    // USDC fixed fee = 0.5, percentage = 100 * 0.01 = 1.0 → total = 1.5
    expect(result.feeFixed).toBe(0.5);
    expect(result.feePercent).toBe(0.01);
    expect(result.totalFee).toBeCloseTo(1.5, 5);
    expect(result.feeDetails.length).toBeGreaterThanOrEqual(1);
  });

  it('applies 0.5 % tier for amounts >= 1 000', () => {
    const result = service.calculateSep24Fee('USDC', 'deposit', 1000);
    // USDC fixed fee = 0.5, percentage = 1000 * 0.005 = 5.0 → total = 5.5
    expect(result.feePercent).toBe(0.005);
    expect(result.totalFee).toBeCloseTo(5.5, 5);
  });

  it('applies 0.5 % reduced tier at exactly 1 000', () => {
    const result = service.calculateSep24Fee('USD', 'withdrawal', 1000);
    expect(result.feePercent).toBe(0.005);
  });

  it('works for withdrawal operation', () => {
    const result = service.calculateSep24Fee('USD', 'withdrawal', 500);
    expect(result.operation).toBe('withdrawal');
    expect(result.feePercent).toBe(0.01);
  });

  it('includes fee_details breakdown', () => {
    const result = service.calculateSep24Fee('USDC', 'deposit', 200);
    const names = result.feeDetails.map(d => d.name);
    expect(names).toContain('Variable fee');
  });

  it('includes fixed fee in details when asset has feeFixed > 0', () => {
    const result = service.calculateSep24Fee('USDC', 'deposit', 200);
    const names = result.feeDetails.map(d => d.name);
    expect(names).toContain('Flat fee');
  });

  it('throws for unknown asset', () => {
    expect(() => service.calculateSep24Fee('XYZ', 'deposit', 100)).toThrow('Unknown asset: XYZ');
  });

  it('is case-insensitive', () => {
    const result = service.calculateSep24Fee('usdc', 'deposit', 100);
    expect(result.assetCode).toBe('USDC');
  });
});
