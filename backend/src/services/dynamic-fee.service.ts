import { redis } from '../lib/redis';
import { stellarService } from './stellar.service';
import { config } from '../config/env';
import logger from '../utils/logger';
import { Server } from '@stellar/stellar-sdk/lib/server';

/**
 * Fee calculation configuration
 */
export interface DynamicFeeConfig {
  /** Cache TTL in seconds (default: 10) */
  cacheTtlSeconds?: number;
  /** Maximum fee cap in stroops (default: 10000 = 0.1 XLM) */
  maxFeeStroops?: number;
  /** Minimum fee in stroops (default: 100 = 0.001 XLM) */
  minFeeStroops?: number;
  /** Percentile for normal transactions (default: 50) */
  normalPercentile?: number;
  /** Percentile for urgent/SEP-24 payouts (default: 90) */
  urgentPercentile?: number;
}

/**
 * Fee stats from Horizon
 */
interface FeeStats {
  lastLedger: number;
  lastLedgerBaseFeeInStroops: number;
  feeChargedMax: number;
  feeChargedMin: number;
  feeChargedMode: number;
  maxFeeMax: number;
  maxFeeMin: number;
  maxFeeMode: number;
  operationFeeStats: Array<{
    percentile: string;
    max: number;
    min: number;
    mode: number;
  }>;
}

/**
 * Recommended fee structure
 */
export interface RecommendedFee {
  /** Fee in stroops */
  fee: number;
  /** Whether this is a surge/fast path fee */
  isSurge: boolean;
  /** Fee level: normal, high, urgent */
  level: 'normal' | 'high' | 'urgent';
  /** Source of fee calculation */
  source: 'p50' | 'p90' | 'p99' | 'default' | 'cached';
}

/**
 * Dynamic Fee Service
 * 
 * Calculates recommended transaction fees based on Horizon fee stats
 * with Redis caching to avoid rate limiting.
 */
export class DynamicFeeService {
  private config: Required<DynamicFeeConfig>;
  private static readonly CACHE_KEY = 'stellar:fee_stats';
  private static readonly DEFAULT_FEE_STROOPS = 100; // 0.001 XLM

  constructor(config: DynamicFeeConfig = {}) {
    this.config = {
      cacheTtlSeconds: config.cacheTtlSeconds ?? 10,
      maxFeeStroops: config.maxFeeStroops ?? 10000,
      minFeeStroops: config.minFeeStroops ?? 100,
      normalPercentile: config.normalPercentile ?? 50,
      urgentPercentile: config.urgentPercentile ?? 90,
    };
  }

  /**
   * Get recommended fee for a transaction
   * @param isUrgent - Whether this is an urgent transaction (SEP-24 payout)
   * @param forceRefresh - Force fetch fresh fee stats from Horizon
   */
  async getRecommendedFee(isUrgent: boolean = false, forceRefresh: boolean = false): Promise<RecommendedFee> {
    const feeStats = await this.getFeeStats(forceRefresh);
    
    if (!feeStats) {
      return this.getDefaultFee(isUrgent);
    }

    const percentile = isUrgent ? this.config.urgentPercentile : this.config.normalPercentile;
    const fee = this.calculateFeeFromStats(feeStats, percentile);
    const cappedFee = this.applyFeeCap(fee);

    const baseFee = feeStats.lastLedgerBaseFeeInStroops;
    const isSurge = cappedFee > baseFee * 1.5;

    return {
      fee: cappedFee,
      isSurge,
      level: this.determineFeeLevel(cappedFee, baseFee),
      source: percentile === 50 ? 'p50' : percentile === 90 ? 'p90' : 'p99',
    };
  }

  /**
   * Get fee stats from Horizon with Redis caching
   */
  async getFeeStats(forceRefresh: boolean = false): Promise<FeeStats | null> {
    // Check cache first unless force refresh
    if (!forceRefresh) {
      const cached = await this.getCachedFeeStats();
      if (cached) {
        return cached;
      }
    }

    try {
      // Fetch fresh fee stats from Horizon
      const server = stellarService.getHorizonServer();
      const response = await server.feeStats().call();
      
      const feeStats: FeeStats = {
        lastLedger: response.last_ledger,
        lastLedgerBaseFeeInStroops: response.last_ledger_base_fee_in_stroops,
        feeChargedMax: response.fee_charged_max,
        feeChargedMin: response.fee_charged_min,
        feeChargedMode: response.fee_charged_mode,
        maxFeeMax: response.max_fee_max,
        maxFeeMin: response.max_fee_min,
        maxFeeMode: response.max_fee_mode,
        operationFeeStats: response.operation_fee_stats ?? [],
      };

      // Cache the result
      await this.cacheFeeStats(feeStats);
      
      logger.debug('[DynamicFee] Fetched fresh fee stats from Horizon', {
        lastLedger: feeStats.lastLedger,
        baseFee: feeStats.lastLedgerBaseFeeInStroops,
      });

      return feeStats;
    } catch (error) {
      logger.error('[DynamicFee] Failed to fetch fee stats from Horizon', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Try to return cached data even if stale
      const cached = await this.getCachedFeeStats(true);
      if (cached) {
        logger.warn('[DynamicFee] Using stale cached fee stats');
        return cached;
      }

      return null;
    }
  }

  /**
   * Calculate fee from fee stats using percentile
   */
  private calculateFeeFromStats(feeStats: FeeStats, percentile: number): number {
    // Find the matching percentile in operation fee stats
    const percentileKey = `p${percentile}`;
    const percentileData = feeStats.operationFeeStats.find(
      (stat) => stat.percentile === percentileKey
    );

    if (percentileData && percentileData.max > 0) {
      return percentileData.max;
    }

    // Fallback to max_fee_max or base fee
    if (feeStats.maxFeeMax > 0) {
      return Math.min(feeStats.maxFeeMax, feeStats.lastLedgerBaseFeeInStroops * 10);
    }

    return feeStats.lastLedgerBaseFeeInStroops;
  }

  /**
   * Apply fee cap limits
   */
  private applyFeeCap(fee: number): number {
    // Ensure minimum
    const withMin = Math.max(fee, this.config.minFeeStroops);
    // Apply maximum cap
    return Math.min(withMin, this.config.maxFeeStroops);
  }

  /**
   * Determine fee level based on comparison to base fee
   */
  private determineFeeLevel(fee: number, baseFee: number): 'normal' | 'high' | 'urgent' {
    const ratio = fee / baseFee;
    
    if (ratio <= 1.2) return 'normal';
    if (ratio <= 2.0) return 'high';
    return 'urgent';
  }

  /**
   * Get default fee when Horizon is unavailable
   */
  private getDefaultFee(isUrgent: boolean): RecommendedFee {
    const fee = isUrgent 
      ? this.config.maxFeeStroops 
      : DynamicFeeService.DEFAULT_FEE_STROOPS;

    return {
      fee,
      isSurge: false,
      level: isUrgent ? 'urgent' : 'normal',
      source: 'default',
    };
  }

  /**
   * Get cached fee stats from Redis
   */
  private async getCachedFeeStats(allowStale: boolean = false): Promise<FeeStats | null> {
    try {
      const cached = await redis.get(DynamicFeeService.CACHE_KEY);
      if (!cached) return null;

      const parsed = JSON.parse(cached) as { data: FeeStats; timestamp: number };
      
      // Check if cache is still valid
      const age = Date.now() - parsed.timestamp;
      const maxAge = allowStale ? this.config.cacheTtlSeconds * 2000 : this.config.cacheTtlSeconds * 1000;
      
      if (age > maxAge) {
        return null;
      }

      return parsed.data;
    } catch (error) {
      logger.error('[DynamicFee] Failed to get cached fee stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Cache fee stats in Redis
   */
  private async cacheFeeStats(feeStats: FeeStats): Promise<void> {
    try {
      const cacheData = JSON.stringify({
        data: feeStats,
        timestamp: Date.now(),
      });
      
      await redis.setEx(
        DynamicFeeService.CACHE_KEY,
        this.config.cacheTtlSeconds,
        cacheData
      );
    } catch (error) {
      logger.error('[DynamicFee] Failed to cache fee stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Calculate total fee for a transaction with multiple operations
   * @param operationCount - Number of operations in the transaction
   * @param isUrgent - Whether this is an urgent transaction
   */
  async getTransactionFee(operationCount: number, isUrgent: boolean = false): Promise<{
    totalFee: number;
    feePerOperation: number;
    isSurge: boolean;
    level: 'normal' | 'high' | 'urgent';
  }> {
    const recommended = await this.getRecommendedFee(isUrgent);
    
    const totalFee = recommended.fee * operationCount;
    const cappedTotal = Math.min(totalFee, this.config.maxFeeStroops * operationCount);
    
    return {
      totalFee: cappedTotal,
      feePerOperation: recommended.fee,
      isSurge: recommended.isSurge,
      level: recommended.level,
    };
  }
}

/**
 * Helper to get fee configuration for contract queue integration
 */
export function getFeeConfigForTransaction(operationCount: number, isUrgent: boolean = false): {
  recommendedFee: number;
  isSurge: boolean;
  level: 'normal' | 'high' | 'urgent';
} {
  // This is a synchronous wrapper for use in transaction building
  // The actual async calculation should be done before calling this
  const defaultFee = isUrgent ? 1000 : 100;
  return {
    recommendedFee: defaultFee,
    isSurge: false,
    level: isUrgent ? 'urgent' : 'normal',
  };
}

// Export singleton instance
export const dynamicFeeService = new DynamicFeeService();

// Export types
export { FeeStats };