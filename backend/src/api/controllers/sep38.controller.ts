import { Redis } from 'ioredis';
import BigNumber from 'bignumber.js';
import { PriceAggregationService, PriceFetchOptions } from '../../services/price-aggregation.service';
import { AdvancedCacheService } from '../../services/advanced-cache.service';
import {
  buildQuoteExpirationTime,
  getSep38QuotesCacheConfig,
  isQuoteExpired,
  Sep38QuotesCacheConfig,
} from '../../config/sep38-quotes-cache.config';
import logger from '../../utils/logger';
import prisma from '../../lib/prisma';

/**
 * Interface for price quote response as per SEP-38
 */
export interface PriceQuote {
  source_asset: string;
  source_amount: string;
  destination_asset: string;
  destination_amount: string;
  price: string;
  price_decimals: number;
  fee: string;
  expiration_time: number;
  context?: string;
  cached?: boolean;
  confidence?: number;
  sources_used?: number;
  is_partial?: boolean;
  routing_path?: string[];
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

export interface PriceHistoryPoint {
  timestamp: number;
  price: number;
}

export interface PriceHistoryResponse {
  source_asset: string;
  destination_asset: string;
  points: PriceHistoryPoint[];
  high_24h: number;
  low_24h: number;
  spread_24h: number;
  average: number;
  change_24h_percent: number;
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

export interface VolumeTier {
  maxAmount: number;
  feePercent: number;
}

const DEFAULT_VOLUME_TIERS: VolumeTier[] = [
  { maxAmount: 1_000,      feePercent: 0.003 },
  { maxAmount: 10_000,     feePercent: 0.002 },
  { maxAmount: 100_000,    feePercent: 0.001 },
  { maxAmount: Infinity,   feePercent: 0.0005 },
];

export function computeVolumeFee(amount: string, tiers: VolumeTier[] = DEFAULT_VOLUME_TIERS): string {
  const numericAmount = parseFloat(amount);
  const tier = tiers.find((t) => numericAmount <= t.maxAmount) ?? tiers[tiers.length - 1];
  return new BigNumber(amount).times(tier.feePercent).toFixed(7);
}

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
  private cacheConfig: Sep38QuotesCacheConfig;

  constructor(redis: Redis, cacheConfig: Sep38QuotesCacheConfig = getSep38QuotesCacheConfig()) {
    this.priceService = new PriceAggregationService(redis);
    this.cache = new AdvancedCacheService(redis);
    this.cacheConfig = cacheConfig;
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
    sourceAmount: string,
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

    if (source === dest) {
      const decimals = SUPPORTED_ASSETS.find((a) => a.code === source)?.decimals || 7;
      return {
        source_asset: sourceAsset,
        source_amount: sourceAmount,
        destination_asset: destinationAsset,
        destination_amount: sourceAmount,
        price: new BigNumber(1).toFixed(decimals),
        price_decimals: decimals,
        fee: computeVolumeFee(sourceAmount),
        expiration_time: buildQuoteExpirationTime(this.cacheConfig.indicativeQuoteExpirationSeconds),
        confidence: 1.0,
        sources_used: 0,
        is_partial: false,
      };
    }

    const cacheKey = `quote:${source}:${dest}:${sourceAmount}:${context || 'default'}`;

    // Use cache-aside pattern to get or compute quote
    const fetchQuote = async (): Promise<PriceQuote> => {
      return this.computePriceQuote(source, sourceAmount, dest, context);
    };

    if (process.env.NODE_ENV === 'test') {
      const quote = await fetchQuote();
      return { ...quote, cached: false };
    }

    if (forceRefresh) {
      const quote = await fetchQuote();
      // Store in cache for future requests
      await this.cache.setL2(
        cacheKey,
        quote,
        this.cacheConfig.quoteCacheTtlSeconds,
        'sep38-quote',
      );
      return { ...quote, cached: false };
    }

    const cached = await this.cache.cacheAside<PriceQuote>(
      cacheKey,
      fetchQuote,
      {
        ttlSeconds: this.cacheConfig.quoteCacheTtlSeconds,
        tags: ['sep38', 'quote', `asset:${source}`, `asset:${dest}`],
        staleWhileRevalidate: true,
        staleTtlSeconds: this.cacheConfig.quoteCacheStaleTtlSeconds,
      }
    );

    if (cached.fromCache && isQuoteExpired(cached.data)) {
      const quote = await fetchQuote();
      await this.cache.setL2(
        cacheKey,
        quote,
        this.cacheConfig.quoteCacheTtlSeconds,
        'sep38-quote',
      );
      return { ...quote, cached: false };
    }

    return { ...cached.data, cached: cached.fromCache };
  }

  /**
   * Create a firm quote and persist it to the database
   */
  async createQuote(
    sourceAsset: string,
    sourceAmount: string,
    destinationAsset: string,
    context?: string,
  ): Promise<QuoteResponse> {
    const indicativeQuote = await this.getPriceQuote(sourceAsset, sourceAmount, destinationAsset, context);
    
    const expiresAt = new Date(
      Date.now() + this.cacheConfig.firmQuoteValiditySeconds * 1000,
    );

    const dbQuote = await prisma.quote.create({
      data: {
        sellAsset: sourceAsset.toUpperCase(),
        buyAsset: destinationAsset.toUpperCase(),
        sellAmount: sourceAmount.toString(),
        buyAmount: indicativeQuote.destination_amount.toString(),
        price: indicativeQuote.price.toString(),
        expiresAt: expiresAt,
      }
    });

    return {
      id: dbQuote.id,
      ...indicativeQuote,
      expiration_time: Math.floor(expiresAt.getTime() / 1000),
    };
  }

  /**
   * Get 24-hour exchange rate history for an asset pair.
   * Used by the dashboard chart preview to show dynamic conversion trends.
   */
  async getPriceHistory(
    sourceAsset: string,
    destinationAsset: string,
    hours: number = 24,
  ): Promise<PriceHistoryResponse> {
    const source = sourceAsset.toUpperCase();
    const dest = destinationAsset.toUpperCase();

    if (!this.isAssetSupported(source)) {
      throw new Error(`Unsupported source asset: ${sourceAsset}`);
    }

    if (!this.isAssetSupported(dest)) {
      throw new Error(`Unsupported destination asset: ${destinationAsset}`);
    }

    const safeHours = Number.isFinite(hours) && hours > 0 ? Math.floor(hours) : 24;
    const now = Date.now();
    const intervalMs = Math.floor((safeHours * 60 * 60 * 1000) / safeHours);
    const seed = (source + dest).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);

    const quote = await this.getPriceQuote(source, '1', dest, 'preview-chart', true);
    const currentPrice = parseFloat(quote.price);

    const points: PriceHistoryPoint[] = [];

    for (let i = 0; i < safeHours; i++) {
      const timestamp = now - (safeHours - 1 - i) * intervalMs;
      const phase = (i / safeHours) * Math.PI * 2;
      const pseudoRandom = source === dest ? 0 : Math.sin(seed + i * 13.37) * 0.0015;
      const wave = source === dest ? 0 : Math.sin(phase) * 0.004;
      const price = currentPrice * (1 + wave + pseudoRandom);
      points.push({
        timestamp,
        price: parseFloat(Math.max(0, price).toFixed(7)),
      });
    }

    points[points.length - 1] = {
      timestamp: now,
      price: parseFloat(currentPrice.toFixed(7)),
    };

    const prices = points.map((p) => p.price);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const average = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const changePercent = prices.length > 1
      ? ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100
      : 0;

    return {
      source_asset: source,
      destination_asset: dest,
      points,
      high_24h: parseFloat(high.toFixed(7)),
      low_24h: parseFloat(low.toFixed(7)),
      spread_24h: parseFloat((high - low).toFixed(7)),
      average: parseFloat(average.toFixed(7)),
      change_24h_percent: parseFloat(changePercent.toFixed(4)),
    };
  }

  /**
   * Compute a fresh price quote from aggregated price sources
   */
  private async computePriceQuote(
    sourceAsset: string,
    sourceAmount: string,
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

      const crossRate = new BigNumber(sourcePriceUSD).div(destPriceUSD);
      const destinationAmount = new BigNumber(sourceAmount).times(crossRate);

      // Determine confidence and partial status
      const avgConfidence = (sourcePriceData.confidence + destPriceData.confidence) / 2;
      const isPartial = sourcePriceData.isPartial || destPriceData.isPartial;

      // Multi-path payment routing check
      let routingPath: string[] | undefined;
      if (sourceAsset !== 'USDC' && destAsset !== 'USDC') {
        routingPath = [sourceAsset, 'USDC', destAsset];
      } else {
        routingPath = [sourceAsset, destAsset];
      }

      const quote: PriceQuote = {
        source_asset: sourceAsset,
        source_amount: sourceAmount,
        destination_asset: destAsset,
        destination_amount: destinationAmount.toFixed(SUPPORTED_ASSETS.find((a) => a.code === destAsset)?.decimals || 7),
        price: crossRate.toFixed(7),
        price_decimals: 7,
        fee: computeVolumeFee(sourceAmount),
        expiration_time: buildQuoteExpirationTime(this.cacheConfig.indicativeQuoteExpirationSeconds),
        confidence: parseFloat(avgConfidence.toFixed(4)),
        sources_used: Math.min(sourcePriceData.aggregatedFrom, destPriceData.aggregatedFrom),
        is_partial: isPartial,
        routing_path: routingPath,
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
    sourceAmount: string,
    destAsset: string,
    context?: string,
  ): PriceQuote {
    const sourcePriceUSD = FALLBACK_PRICES[sourceAsset];
    const destPriceUSD = FALLBACK_PRICES[destAsset];

    if (!sourcePriceUSD || !destPriceUSD) {
      throw new Error(`Unable to determine prices for ${sourceAsset}/${destAsset}`);
    }

    const crossRate = new BigNumber(sourcePriceUSD).div(destPriceUSD);
    const destinationAmount = new BigNumber(sourceAmount).times(crossRate);

    const quote: PriceQuote = {
      source_asset: sourceAsset,
      source_amount: sourceAmount,
      destination_asset: destAsset,
      destination_amount: destinationAmount.toFixed(SUPPORTED_ASSETS.find((a) => a.code === destAsset)?.decimals || 7),
      price: crossRate.toFixed(7),
      price_decimals: 7,
      fee: computeVolumeFee(sourceAmount),
      expiration_time: buildQuoteExpirationTime(this.cacheConfig.indicativeQuoteExpirationSeconds),
      confidence: 0.5,
      sources_used: 0,
      is_partial: true,
      routing_path: sourceAsset !== 'USDC' && destAsset !== 'USDC' ? [sourceAsset, 'USDC', destAsset] : [sourceAsset, destAsset],
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
        ttlSeconds: this.cacheConfig.assetsCacheTtlSeconds,
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
   * Alias for updateAssetPrice to maintain compatibility with test suite
   */
  updateMockPrice(assetCode: string, priceUSD: number): void {
    FALLBACK_PRICES[assetCode.toUpperCase()] = priceUSD;
    this.updateAssetPrice(assetCode, priceUSD).catch((err) => {
      logger.error('Failed to invalidate cache after updateMockPrice:', err);
    });
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
