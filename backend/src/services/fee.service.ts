import { RedisService } from './redis.service';
import { getAsset, AssetConfig, FeeType } from '../config/assets';
import logger from '../utils/logger';
import { config } from '../config/env';
import { DECIMAL_PRECISION, formatDecimal, toDecimal } from '../utils/decimal';

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

export interface AssetFeeResult {
  assetCode: string;
  feeType: FeeType;
  inputAmount: number;
  feeAmount: number;
  feeFixed: number;
  feePercent: number;
  feeMinimum: number;
}

/**
 * Computes the fee for a given asset config and amount according to its `feeType`.
 *
 *  - flat:        feeFixed only.
 *  - percentage:  amount * feePercent, floored to feeMinimum.
 *  - tiered:      feeFixed + (amount * feePercent), floored to feeMinimum.
 */
export function computeAssetFee(asset: AssetConfig, amount: number | string): number {
  const amountValue = toDecimal(amount);
  let fee = toDecimal(0);

  switch (asset.feeType) {
    case 'flat':
      fee = toDecimal(asset.feeFixed);
      break;
    case 'percentage':
      fee = amountValue.times(asset.feePercent);
      break;
    case 'tiered':
      fee = toDecimal(asset.feeFixed).plus(amountValue.times(asset.feePercent));
      break;
    default:
      // Fallback: treat unknown feeType as tiered
      fee = toDecimal(asset.feeFixed).plus(amountValue.times(asset.feePercent));
  }

  // Enforce the per-asset minimum fee
  if (asset.feeMinimum > 0 && fee.lt(asset.feeMinimum)) {
    fee = toDecimal(asset.feeMinimum);
  }

  // Round to 7 decimal places to avoid floating-point dust
  return Number(formatDecimal(fee, DECIMAL_PRECISION));
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
    const estimatedFeeXLM = formatDecimal(toDecimal(estimatedFeeStroops).dividedBy(1e7));

    return {
      estimatedFeeStroops,
      estimatedFeeXLM,
      surgeActive: stats.surgeActive,
      surgeMultiplier: stats.surgeMultiplier,
      operationCount,
    };
  }

  /**
   * Calculates the fee for a specific asset and amount using the asset's
   * configured fee strategy (flat / percentage / tiered).
   *
   * Throws if the asset code is unknown.
   */
  calculateAssetFee(assetCode: string, amount: number | string): AssetFeeResult {
    const asset = getAsset(assetCode);
    if (!asset) {
      throw new Error(`Unknown asset: ${assetCode}`);
    }

    const feeAmount = computeAssetFee(asset, amount);

    return {
      assetCode: asset.code,
      feeType: asset.feeType,
      inputAmount: Number(formatDecimal(toDecimal(amount))),
      feeAmount,
      feeFixed: asset.feeFixed,
      feePercent: asset.feePercent,
      feeMinimum: asset.feeMinimum,
    };
  }

  /**
   * Calculates an itemized SEP-24 fee breakdown for a given asset, operation,
   * and amount. Applies tiered percentage rules on top of any asset-level fixed
   * fee:
   *
   *  - amount  < 1 000  → 1.00 % percentage tier
   *  - amount >= 1 000  → 0.50 % percentage tier
   *
   * Returns individual line items (fixed_fee, percentage_fee) so wallets can
   * display a transparent cost breakdown to the user.
   */
  calculateSep24Fee(
    assetCode: string,
    operation: 'deposit' | 'withdrawal',
    amount: number | string,
  ): Sep24FeeResult {
    const asset = getAsset(assetCode);
    if (!asset) {
      throw new Error(`Unknown asset: ${assetCode}`);
    }

    const amountValue = Number(formatDecimal(toDecimal(amount)));

    // Tiered percentage: 1 % below $1 000, 0.5 % at or above $1 000
    const tierPercent = amountValue < 1_000 ? 0.01 : 0.005;

    const fixedFee = Number(formatDecimal(toDecimal(asset.feeFixed)));
    const percentageFee = Number(
      formatDecimal(toDecimal(amountValue).times(tierPercent), DECIMAL_PRECISION),
    );
    const totalFee = Number(
      formatDecimal(toDecimal(fixedFee).plus(percentageFee), DECIMAL_PRECISION),
    );

    const feeDetails: Sep24FeeDetail[] = [];

    if (fixedFee > 0) {
      feeDetails.push({
        name: 'Flat fee',
        amount: String(fixedFee),
        description: `Flat processing fee for ${operation}`,
      });
    }

    feeDetails.push({
      name: 'Variable fee',
      amount: String(percentageFee),
      description: `${(tierPercent * 100).toFixed(2)}% fee (${amountValue < 1_000 ? 'standard tier' : 'reduced tier for amounts ≥ 1 000'})`,
    });

    return {
      assetCode: asset.code,
      operation,
      inputAmount: amountValue,
      totalFee,
      feeFixed: fixedFee,
      feePercent: tierPercent,
      feeDetails,
    };
  }
}

// ─── SEP-24 itemized fee types ────────────────────────────────────────────────

export interface Sep24FeeDetail {
  /** Human-readable name of the fee component. */
  name: string;
  /** Fee amount as a string for precision. */
  amount: string;
  /** Optional explanation shown to the end user. */
  description?: string;
}

export interface Sep24FeeResult {
  assetCode: string;
  operation: 'deposit' | 'withdrawal';
  inputAmount: number;
  totalFee: number;
  feeFixed: number;
  feePercent: number;
  feeDetails: Sep24FeeDetail[];
}
