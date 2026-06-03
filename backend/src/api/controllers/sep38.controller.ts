import { Redis } from 'ioredis';
import { PriceAggregationService, AggregatedPrice, PriceFetchOptions } from '../../services/price-aggregation.service';
import { AdvancedCacheService, CacheAsideResult } from '../../services/advanced-cache.service';
import logger from '../../utils/logger';
import prisma from '../../lib/prisma';

/**
 * Interface for price quote response as per SEP-38
 */
export interface PriceQuote {
  source_asset: string;
  source_amount: number;
  destination_asset: string;
  destination_amount: number;
  price: number;
  expiration_time: number;
  context?: string;
  cached?: boolean;
  confidence?: number;
  sources_used?: number;
  is_partial?: boolean;
}

export interface QuoteResponse extends PriceQuote {
  id: string;
}

/**
 * Interface for supported asset information
 */
export interface AssetInfo {
  code: string;
  issuer?: string;
  asset_type: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  name: string;
  description?: string;
  decimals: number;
}

/**
 * Mock price data - Fallback when external sources are unavailable
 */
const FALLBACK_PRICES: Record<string, number> = {
  XLM: 0.12,
  USDC: 1.0,
  USDT: 1.0,
  BTC: 45000.0,
  ETH: 2500.0,
};

/**
 * Supported assets configuration
 */
const SUPPORTED_ASSETS: AssetInfo[] = [
  {
    code: 'XLM',
    asset_type: 'native',
    name: 'Stellar Lumens',
    description: 'Native Stellar network token',
    decimals: 7,
  },
  {
    code: 'USDC',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    asset_type: 'credit_alphanum4',
    name: 'USD Coin',
    description: 'Fully backed stablecoin',
    decimals: 7,
  },
  {
    code: 'USDT',
    issuer: 'GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V',
    asset_type: 'credit_alphanum4',
    name: 'Tether',
    description: 'USD-pegged stablecoin',
    decimals: 7,
  },
  {
    code: 'BTC',
    asset_type: 'credit_alphanum4',
    name: 'Bitcoin',
    description: 'Bitcoin wrapped on Stellar',
    decimals: 7,
  },
  {
    code: 'ETH',
    asset_type: 'credit_alphanum4',
    name: 'Ethereum',
    description: 'Ethereum wrapped on Stellar',
    decimals: 7,
  },
];

export class Sep38Controller {
  private priceService: PriceAggregationService;
  private cache: AdvancedCacheService;
  private assetsCacheKey = 'sep38:supported_assets';
  private quoteCacheTtlSeconds = 30;

  constructor(redis: Redis) {
    this.priceService = new PriceAggregationService(redis);
    this.cache = new AdvancedCacheService(redis);
  }

  /**
   * Get a cached price quote for exchanging one asset for another
   * Uses multi-level caching with cache-aside pattern
   * 
   * @param sourceAsset - The asset to sell
   * @param sourceAmount - Amount of source asset to sell
   * @param destinationAsset - The asset to buy
   * @param context - Optional context (e.g., "SEP-24")
   * @param forceRefresh - Force refresh from sources, bypassing cache
   * @returns Price quote object with caching metadata
   */
  async getPriceQuote(
    sourceAsset: string,
    sourceAmount: number,
    destinationAsset: string,
    context?: string,
    forceRefresh?: boolean,
  ): Promise<PriceQuote> {
    const source = sourceAsset.toUpperCase();
    const dest = destinationAsset.toUpperCase();

    // Validate assets are supported
    if (!this.isAssetSupported(source)) {
      throw new Error(`Unsupported source asset: ${sourceAsset}`);
    }

    if (!this.isAssetSupported(dest)) {
      throw new Error(`Unsupported destination asset: ${destinationAsset}`);
    }

    const cacheKey = `quote:${source}:${dest}:${sourceAmount}:${context || 'default'}`;

    // Use cache-aside pattern to get or compute quote
    const fetchQuote = async (): Promise<PriceQuote> => {
      return this.computePriceQuote(source, sourceAmount, dest, context);
    };

    if (forceRefresh) {
      const quote = await fetchQuote();
      // Store in cache for future requests
      await this.cache.setL2(cacheKey, quote, this.quoteCacheTtlSeconds, 'sep38-quote');
      return { ...quote, cached: false };
    }

    const cached = await this.cache.cacheAside<PriceQuote>(
      cacheKey,
      fetchQuote,
      {
        ttlSeconds: this.quoteCacheTtlSeconds,
        tags: ['sep38', 'quote', `asset:${source}`, `asset:${dest}`],
        staleWhileRevalidate: true,
        staleTtlSeconds: 120,
      }
    );

    return { ...cached.data, cached: cached.fromCache };
  }

  /**
   * Compute a fresh price quote from aggregated price sources
   */
  private async computePriceQuote(
    sourceAsset: string,
    sourceAmount: number,
    destAsset: string,
    context?: string,
  ): Promise<PriceQuote> {
    try {
      // Fetch aggregated prices for both assets
      const fetchOptions: PriceFetchOptions = {
        minSources: 1,
        staleWhileRevalidate: true,
      };

      const [sourcePriceData, destPriceData] = await Promise.all([
        this.priceService.getPrice(sourceAsset, fetchOptions),
        this.priceService.getPrice(destAsset, fetchOptions),
      ]);

      // Calculate cross rate
      const sourcePriceUSD = sourcePriceData.price;
      const destPriceUSD = destPriceData.price;

      if (sourcePriceUSD <= 0 || destPriceUSD <= 0) {
        throw new Error('Invalid price data received');
      }

      const crossRate = sourcePriceUSD / destPriceUSD;
      const destinationAmount = sourceAmount * crossRate;

      // Determine confidence and partial status
      const avgConfidence = (sourcePriceData.confidence + destPriceData.confidence) / 2;
      const isPartial = sourcePriceData.isPartial || destPriceData.isPartial;

      const quote: PriceQuote = {
        source_asset: sourceAsset,
        source_amount: sourceAmount,
        destination_asset: destAsset,
        destination_amount: parseFloat(destinationAmount.toFixed(7)),
        price: parseFloat(crossRate.toFixed(7)),
        expiration_time: Math.floor(Date.now() / 1000) + 60,
        confidence: parseFloat(avgConfidence.toFixed(4)),
        sources_used: Math.min(sourcePriceData.aggregatedFrom, destPriceData.aggregatedFrom),
        is_partial: isPartial,
      };

      if (context) {
        quote.context = context;
      }

      return quote;
    } catch (err) {
      logger.error('Failed to compute price from aggregated sources:', err);

      // Fallback to mock prices if aggregation fails
      return this.computeFallbackQuote(sourceAsset, sourceAmount, destAsset, context);
    }
  }

  /**
   * Compute a fallback quote using static prices
   */
  private computeFallbackQuote(
    sourceAsset: string,
    sourceAmount: number,
    destAsset: string,
    context?: string,
  ): PriceQuote {
    const sourcePriceUSD = FALLBACK_PRICES[sourceAsset];
    const destPriceUSD = FALLBACK_PRICES[destAsset];

    if (!sourcePriceUSD || !destPriceUSD) {
      throw new Error(`Unable to determine prices for ${sourceAsset}/${destAsset}`);
    }

    const crossRate = sourcePriceUSD / destPriceUSD;
    const destinationAmount = sourceAmount * crossRate;

    const quote: PriceQuote = {
      source_asset: sourceAsset,
      source_amount: sourceAmount,
      destination_asset: destAsset,
      destination_amount: parseFloat(destinationAmount.toFixed(7)),
      price: parseFloat(crossRate.toFixed(7)),
      expiration_time: Math.floor(Date.now() / 1000) + 60,
      confidence: 0.5,
      sources_used: 0,
      is_partial: true,
    };

    if (context) {
      quote.context = context;
    }

    logger.warn(`Using fallback prices for ${sourceAsset}/${destAsset} quote`);
    return quote;
  }

  /**
   * Get list of supported assets with caching
   * Uses write-through pattern for consistency
   * 
   * @returns Array of supported asset information
   */
  async getSupportedAssets(): Promise<AssetInfo[]> {
    const fetchAssets = async (): Promise<AssetInfo[]> => {
      return [...SUPPORTED_ASSETS];
    };

    const cached = await this.cache.cacheAside<AssetInfo[]>(
      this.assetsCacheKey,
      fetchAssets,
      {
        ttlSeconds: 3600,
        tags: ['sep38', 'assets'],
      }
    );

    return cached.data;
  }

  /**
   * Check if an asset is supported
   */
  private isAssetSupported(assetCode: string): boolean {
    return SUPPORTED_ASSETS.some((a) => a.code === assetCode);
  }

  /**
   * Add a new supported asset with cache invalidation
   * This would typically be protected by authentication in production
   */
  async addSupportedAsset(asset: AssetInfo): Promise<void> {
    // Check if asset already exists
    const existingIndex = SUPPORTED_ASSETS.findIndex(
      (a) => a.code === asset.code && a.issuer === asset.issuer
    );

    if (existingIndex !== -1) {
      SUPPORTED_ASSETS[existingIndex] = asset;
    } else {
      SUPPORTED_ASSETS.push(asset);
    }

    // Use write-through pattern: update source then invalidate cache
    await this.cache.invalidate(this.assetsCacheKey);
    logger.info(`Updated supported assets, invalidated cache for ${asset.code}`);
  }

  /**
   * Update asset price with distributed cache invalidation
   * Useful for manual price adjustments or admin operations
   */
  async updateAssetPrice(assetCode: string, priceUSD: number): Promise<void> {
    FALLBACK_PRICES[assetCode.toUpperCase()] = priceUSD;

    // Invalidate related caches
    const asset = assetCode.toUpperCase();
    await Promise.all([
      this.priceService.invalidatePrice(asset),
      this.cache.invalidatePattern(`quote:${asset}:*`),
      this.cache.invalidatePattern(`quote:*:${asset}:*`),
    ]);

    logger.info(`Updated price for ${assetCode} to ${priceUSD}, invalidated related caches`);
  }

  /**
   * Invalidate all price quotes and price caches
   * Useful for forcing fresh price fetches
   */
  async invalidateAllCaches(): Promise<void> {
    await Promise.all([
      this.priceService.invalidateAllPrices(),
      this.cache.invalidateByTags(['sep38']),
    ]);

    logger.info('Invalidated all SEP-38 caches');
  }

  /**
   * Get cache statistics for monitoring
   */
  async getCacheStats(): Promise<{
    l1Size: number;
    l1MaxSize: number;
    circuitBreakerMetrics: Record<string, unknown>;
  }> {
    const stats = this.cache.getStats();
    const circuitBreakerMetrics = this.priceService.getCircuitBreakerMetrics();

    return {
      l1Size: stats.l1Size,
      l1MaxSize: stats.l1MaxSize,
      circuitBreakerMetrics,
    };
  }

  /**
   * Reset circuit breakers - useful for recovery operations
   */
  resetCircuitBreakers(): void {
    this.priceService.resetCircuitBreakers();
    logger.info('Reset all circuit breakers');
  }

  /**
   * Clean up resources
   */
  async disconnect(): Promise<void> {
    await this.priceService.disconnect();
    await this.cache.disconnect();
  }
}

// Export singleton instance with default Redis client
// Note: In production, inject the Redis client through proper DI
import { redis } from '../../lib/redis';
export const sep38Controller = new Sep38Controller(redis);
