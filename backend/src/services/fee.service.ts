import { RedisService } from './redis.service';
import logger from '../utils/logger';
import { config } from '../config/env';

const HORIZON_URL = config.HORIZON_URL;
const CACHE_KEY = 'fee_engine:stats';
const CACHE_TTL_SECONDS = 30; // refresh every 30s

// Surge protection thresholds
const SURGE_MULTIPLIER_CAP = 5.0;   // never charge more than 5x base
const SURGE_THRESHOLD_P95 = 2.0;    // p95 > 2x p50 → surge active
const BASE_FEE_STROOPS = 100;        // Stellar minimum base fee

export interface FeeStats {
  baseFeeStroops: number;
  surgeActive: boolean;
  surgeMultiplier: number;
  recommendedFeeStroops: number;
  p10FeeStroops: number;
  p50FeeStroops: number;
  p95FeeStroops: number;
  ledgerCapacityUsage: number; // 0–1
  fetchedAt: string;
}

interface HorizonFeeStats {
  fee_charged: {
    min: string;
    max: string;
    mode: string;
    p10: string;
    p20: string;
    p30: string;
    p40: string;
    p50: string;
    p60: string;
    p70: string;
    p80: string;
    p90: string;
    p95: string;
    p99: string;
  };
  ledger_capacity_usage: string;
}

/**
 * Fetches raw fee_stats from Horizon.
 */
async function fetchHorizonFeeStats(): Promise<HorizonFeeStats> {
  const res = await fetch(`${HORIZON_URL}/fee_stats`);
  if (!res.ok) {
    throw new Error(`Horizon fee_stats returned ${res.status}`);
  }
  return res.json() as Promise<HorizonFeeStats>;
}

/**
 * Computes a surge multiplier based on p95/p50 ratio and ledger capacity.
 * Returns a value between 1.0 and SURGE_MULTIPLIER_CAP.
 */
function computeSurgeMultiplier(
  p50: number,
  p95: number,
  capacityUsage: number
): { multiplier: number; surgeActive: boolean } {
  const feeRatio = p50 > 0 ? p95 / p50 : 1;
  const surgeActive = feeRatio >= SURGE_THRESHOLD_P95 || capacityUsage >= 0.8;

  if (!surgeActive) return { multiplier: 1.0, surgeActive: false };

  // Scale multiplier: blend fee ratio and capacity pressure
  const capacityPressure = Math.max(0, (capacityUsage - 0.8) / 0.2); // 0–1 above 80%
  const rawMultiplier = feeRatio * (1 + capacityPressure * 0.5);
  const multiplier = Math.min(rawMultiplier, SURGE_MULTIPLIER_CAP);

  return { multiplier: parseFloat(multiplier.toFixed(2)), surgeActive: true };
}

/**
 * Builds a FeeStats object from Horizon data.
 */
function buildFeeStats(raw: HorizonFeeStats): FeeStats {
  const p10 = parseInt(raw.fee_charged.p10, 10) || BASE_FEE_STROOPS;
  const p50 = parseInt(raw.fee_charged.p50, 10) || BASE_FEE_STROOPS;
  const p95 = parseInt(raw.fee_charged.p95, 10) || BASE_FEE_STROOPS;
  const capacityUsage = parseFloat(raw.ledger_capacity_usage) || 0;

  const { multiplier, surgeActive } = computeSurgeMultiplier(p50, p95, capacityUsage);

  // Recommended fee: p95 during surge (ensures inclusion), p50 otherwise
  const recommendedFeeStroops = surgeActive
    ? Math.ceil(p95 * multiplier)
    : p50;

  return {
    baseFeeStroops: BASE_FEE_STROOPS,
    surgeActive,
    surgeMultiplier: multiplier,
    recommendedFeeStroops,
    p10FeeStroops: p10,
    p50FeeStroops: p50,
    p95FeeStroops: p95,
    ledgerCapacityUsage: capacityUsage,
    fetchedAt: new Date().toISOString(),
  };
}

export class FeeService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Returns current fee stats, using Redis cache when available.
   */
  async getFeeStats(): Promise<FeeStats> {
    const cached = await this.redis.getJSON<FeeStats>(CACHE_KEY);
    if (cached) return cached;

    const raw = await fetchHorizonFeeStats();
    const stats = buildFeeStats(raw);

    await this.redis.setJSON(CACHE_KEY, stats, CACHE_TTL_SECONDS);
    logger.info('Fee stats refreshed from Horizon', {
      surgeActive: stats.surgeActive,
      recommended: stats.recommendedFeeStroops,
      capacity: stats.ledgerCapacityUsage,
    });

    return stats;
  }

  /**
   * Estimates the total fee for a transaction with `operationCount` operations.
   * Stellar charges baseFee * operationCount per transaction.
   */
  async estimateFee(operationCount = 1): Promise<{
    estimatedFeeStroops: number;
    estimatedFeeXLM: string;
    surgeActive: boolean;
    surgeMultiplier: number;
    operationCount: number;
  }> {
    const stats = await this.getFeeStats();
    const estimatedFeeStroops = stats.recommendedFeeStroops * operationCount;
    const estimatedFeeXLM = (estimatedFeeStroops / 1e7).toFixed(7);

    return {
      estimatedFeeStroops,
      estimatedFeeXLM,
      surgeActive: stats.surgeActive,
      surgeMultiplier: stats.surgeMultiplier,
      operationCount,
    };
  }
}
