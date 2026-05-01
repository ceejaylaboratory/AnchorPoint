import { Redis } from 'ioredis';
import logger from '../utils/logger';
import { AdvancedCacheService, CacheOptions } from './advanced-cache.service';
import {
  CircuitBreakerRegistry,
  CircuitBreakerError,
  circuitBreakerRegistry,
} from './circuit-breaker.service';

export interface PriceSourceConfig {
  name: string;
  weight: number;
  priority: number;
  timeoutMs: number;
  circuitBreaker?: {
    failureThreshold?: number;
    resetTimeoutMs?: number;
  };
}

export interface AggregatedPrice {
  asset: string;
  price: number;
  timestamp: number;
  sources: PriceSourceResult[];
  aggregatedFrom: number;
  totalSources: number;
  confidence: number;
  isPartial: boolean;
}

export interface PriceSourceResult {
  source: string;
  price: number;
  timestamp: number;
  weight: number;
  success: boolean;
  error?: string;
  latencyMs: number;
}

export interface PriceFetchOptions {
  minSources?: number;
  maxAgeMs?: number;
  preferCache?: boolean;
  forceRefresh?: boolean;
  staleWhileRevalidate?: boolean;
}

interface HorizonTradeRecord {
  asset_type: string;
  asset_code: string;
  asset_issuer: string;
  amount: string;
  num_accounts: number;
}

interface HorizonTradeAggregationRecord {
  timestamp: number;
  trade_count: number;
  base_volume: string;
  counter_volume: string;
  avg: string;
  high: string;
  low: string;
  open: string;
  close: string;
}

interface HorizonAssetResponse {
  _embedded?: {
    records: HorizonTradeRecord[];
  };
}

interface HorizonTradeAggregationResponse {
  _embedded?: {
    records: HorizonTradeAggregationRecord[];
  };
}

interface ExchangePriceResponse {
  [assetPair: string]: {
    price: string;
  };
}

class HorizonPriceSource {
  private baseUrl: string;
  private circuitBreaker = circuitBreakerRegistry.get('horizon', {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
  });

  constructor(private config: PriceSourceConfig) {
    this.baseUrl = process.env.HORIZON_URL || 'https://horizon.stellar.org';
  }

  async fetchPrice(asset: string): Promise<PriceSourceResult> {
    const startTime = Date.now();

    try {
      const price = await this.circuitBreaker.execute(async () => {
        if (asset === 'XLM') {
          return await this.fetchNativePrice();
        } else {
          return await this.fetchAssetPrice(asset);
        }
      });

      return {
        source: this.config.name,
        price,
        timestamp: Date.now(),
        weight: this.config.weight,
        success: true,
        latencyMs: Date.now() - startTime,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`Horizon price fetch failed for ${asset}:`, error);

      return {
        source: this.config.name,
        price: 0,
        timestamp: Date.now(),
        weight: this.config.weight,
        success: false,
        error,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  private async fetchNativePrice(): Promise<number> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const tradeResponse = await fetch(
        `${this.baseUrl}/trade_aggregations?base_asset_type=native&counter_asset_type=credit_alphanum4&counter_asset_code=USDC&counter_asset_issuer=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN&limit=1&order=desc`,
        {
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);

      if (!tradeResponse.ok) {
        throw new Error(`HTTP ${tradeResponse.status}`);
      }

      const tradeData = await tradeResponse.json() as HorizonTradeAggregationResponse;

      if (tradeData?._embedded?.records?.[0]) {
        const trade = tradeData._embedded.records[0];
        const price = parseFloat(trade.avg || '0');
        if (!isNaN(price) && price > 0) {
          return price;
        }
      }

      const fallbackPrice = await this.fetchFallbackPrice('XLM');
      return fallbackPrice;
    } catch (err) {
      throw new Error(`Failed to fetch native price: ${(err as Error).message}`);
    }
  }

  private async fetchAssetPrice(asset: string): Promise<number> {
    try {
      const issuer = await this.resolveAssetIssuer(asset);
      if (!issuer) {
        throw new Error(`Could not resolve issuer for ${asset}`);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(
        `${this.baseUrl}/assets?asset_code=${asset}&asset_issuer=${issuer}&limit=1`,
        {
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as HorizonAssetResponse;

      const assetData = data?._embedded?.records?.[0];
      if (!assetData) {
        throw new Error(`Asset ${asset} not found on Horizon`);
      }

      const fallbackPrice = await this.fetchFallbackPrice(asset);
      return fallbackPrice;
    } catch (err) {
      throw new Error(`Failed to fetch asset price: ${(err as Error).message}`);
    }
  }

  private async resolveAssetIssuer(asset: string): Promise<string | null> {
    const issuerMap: Record<string, string> = {
      USDC: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      USDT: 'GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V',
    };
    return issuerMap[asset] || null;
  }

  private async fetchFallbackPrice(asset: string): Promise<number> {
    return 0;
  }
}

class ExternalExchangeSource {
  private circuitBreaker = circuitBreakerRegistry.get('external-exchange', {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
  });

  constructor(private config: PriceSourceConfig) {}

  async fetchPrice(asset: string): Promise<PriceSourceResult> {
    const startTime = Date.now();

    try {
      const price = await this.circuitBreaker.execute(async () => {
        return await this.fetchFromMultipleExchanges(asset);
      });

      return {
        source: this.config.name,
        price,
        timestamp: Date.now(),
        weight: this.config.weight,
        success: true,
        latencyMs: Date.now() - startTime,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      logger.error(`External exchange price fetch failed for ${asset}:`, error);

      return {
        source: this.config.name,
        price: 0,
        timestamp: Date.now(),
        weight: this.config.weight,
        success: false,
        error,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  private async fetchFromMultipleExchanges(asset: string): Promise<number> {
    const exchanges = [
      { name: 'binance', url: `https://api.binance.com/api/v3/ticker/price?symbol=${asset}USDT` },
      { name: 'coinbase', url: `https://api.coinbase.com/v2/exchange-rates?currency=${asset}` },
    ];

    const promises = exchanges.map(async (exchange) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(exchange.url, {
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        return this.extractPrice(data, exchange.name, asset);
      } catch (err) {
        logger.warn(`Exchange ${exchange.name} failed for ${asset}`);
        return null;
      }
    });

    const results = await Promise.all(promises);
    const validPrices = results.filter((p): p is number => p !== null && !isNaN(p) && p > 0);

    if (validPrices.length === 0) {
      throw new Error('No valid prices from any exchange');
    }

    return this.calculateMedian(validPrices);
  }

  private extractPrice(data: unknown, exchange: string, asset: string): number | null {
    try {
      if (exchange === 'binance') {
        const price = (data as { price: string }).price;
        return parseFloat(price);
      } else if (exchange === 'coinbase') {
        const rates = (data as { data: { rates: { USD: string } } }).data?.rates;
        if (rates?.USD) {
          return parseFloat(rates.USD);
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private calculateMedian(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
}

export class PriceAggregationService {
  private cache: AdvancedCacheService;
  private sources: Map<string, HorizonPriceSource | ExternalExchangeSource>;
  private defaultMinSources = 1;

  constructor(
    redis: Redis,
    sourceConfigs?: PriceSourceConfig[]
  ) {
    this.cache = new AdvancedCacheService(redis);
    this.sources = new Map();

    const configs = sourceConfigs || this.getDefaultSourceConfigs();
    for (const config of configs) {
      if (config.name === 'horizon') {
        this.sources.set(config.name, new HorizonPriceSource(config));
      } else {
        this.sources.set(config.name, new ExternalExchangeSource(config));
      }
    }
  }

  private getDefaultSourceConfigs(): PriceSourceConfig[] {
    return [
      {
        name: 'horizon',
        weight: 0.6,
        priority: 1,
        timeoutMs: 5000,
      },
      {
        name: 'external-exchange',
        weight: 0.4,
        priority: 2,
        timeoutMs: 5000,
      },
    ];
  }

  async getPrice(
    asset: string,
    options: PriceFetchOptions = {}
  ): Promise<AggregatedPrice> {
    const cacheKey = `price:${asset.toUpperCase()}`;
    const minSources = options.minSources || this.defaultMinSources;

    if (!options.forceRefresh && options.preferCache !== false) {
      const cached = await this.cache.cacheAside<AggregatedPrice>(
        cacheKey,
        () => this.fetchAndAggregate(asset, minSources),
        {
          ttlSeconds: 60,
          tags: ['price', `asset:${asset}`],
          staleWhileRevalidate: options.staleWhileRevalidate ?? true,
          staleTtlSeconds: 300,
        }
      );

      return cached.data;
    }

    const aggregated = await this.fetchAndAggregate(asset, minSources);

    await this.cache.setL2(
      cacheKey,
      aggregated,
      300,
      'price-aggregation'
    );

    return aggregated;
  }

  async getMultiplePrices(
    assets: string[],
    options: PriceFetchOptions = {}
  ): Promise<Map<string, AggregatedPrice>> {
    const results = new Map<string, AggregatedPrice>();
    const errors: { asset: string; error: Error }[] = [];

    const promises = assets.map(async (asset) => {
      try {
        const price = await this.getPrice(asset, options);
        results.set(asset, price);
      } catch (err) {
        errors.push({ asset, error: err as Error });
        logger.error(`Failed to fetch price for ${asset}:`, err);
      }
    });

    await Promise.all(promises);

    if (errors.length > 0 && results.size === 0) {
      throw new AggregateError(
        errors.map((e) => e.error),
        'All price fetches failed'
      );
    }

    return results;
  }

  private async fetchAndAggregate(
    asset: string,
    minSources: number
  ): Promise<AggregatedPrice> {
    const sourcePromises = Array.from(this.sources.values()).map((source) =>
      source.fetchPrice(asset).catch((err): PriceSourceResult => ({
        source: 'unknown',
        price: 0,
        timestamp: Date.now(),
        weight: 0,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        latencyMs: 0,
      }))
    );

    const results = await Promise.all(sourcePromises);
    const successfulResults = results.filter((r) => r.success);

    if (successfulResults.length < minSources) {
      throw new Error(
        `Insufficient data sources for ${asset}: got ${successfulResults.length}, need ${minSources}`
      );
    }

    const aggregatedPrice = this.calculateWeightedAverage(successfulResults);
    const confidence = this.calculateConfidence(successfulResults, results.length);

    return {
      asset: asset.toUpperCase(),
      price: aggregatedPrice,
      timestamp: Date.now(),
      sources: results,
      aggregatedFrom: successfulResults.length,
      totalSources: results.length,
      confidence,
      isPartial: successfulResults.length < results.length,
    };
  }

  private calculateWeightedAverage(results: PriceSourceResult[]): number {
    let totalWeight = 0;
    let weightedSum = 0;

    for (const result of results) {
      totalWeight += result.weight;
      weightedSum += result.price * result.weight;
    }

    if (totalWeight === 0) {
      const prices = results.map((r) => r.price);
      return prices.reduce((a, b) => a + b, 0) / prices.length;
    }

    return weightedSum / totalWeight;
  }

  private calculateConfidence(
    successful: PriceSourceResult[],
    total: number
  ): number {
    const availabilityRatio = successful.length / total;
    const consistencyScore = this.calculateConsistencyScore(successful);
    return (availabilityRatio * 0.4 + consistencyScore * 0.6);
  }

  private calculateConsistencyScore(results: PriceSourceResult[]): number {
    if (results.length < 2) return 1;

    const prices = results.map((r) => r.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    const coefficientOfVariation = stdDev / mean;
    return Math.max(0, 1 - coefficientOfVariation);
  }

  async invalidatePrice(asset: string): Promise<void> {
    const cacheKey = `price:${asset.toUpperCase()}`;
    await this.cache.invalidate(cacheKey);
  }

  async invalidateAllPrices(): Promise<void> {
    await this.cache.invalidateByTags(['price']);
  }

  getCircuitBreakerMetrics(): Record<string, unknown> {
    return circuitBreakerRegistry.getMetrics();
  }

  resetCircuitBreakers(): void {
    circuitBreakerRegistry.resetAll();
  }

  async getCacheStats(): Promise<{ l1Size: number; l1MaxSize: number }> {
    return this.cache.getStats();
  }

  async disconnect(): Promise<void> {
    await this.cache.disconnect();
  }
}

export const createPriceAggregationService = (redis: Redis): PriceAggregationService => {
  return new PriceAggregationService(redis);
};
