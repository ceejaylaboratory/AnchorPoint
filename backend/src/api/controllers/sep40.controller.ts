import prisma from '../../lib/prisma';
import logger from '../../utils/logger';

/**
 * SEP-40 Swap Rates Interface
 * Provides standardized way for wallets to request real-time swap rates
 * for on-chain asset pairs managed by the anchor.
 */

interface AssetPair {
  sell_asset: string;
  buy_asset: string;
}

interface SwapRate {
  sell_asset: string;
  buy_asset: string;
  rate: number;
  decimals: number;
}

interface SwapRateResponse {
  rates: SwapRate[];
  errors: { pair: string; reason: string }[];
}

/**
 * Mock swap rate data - in production, this would come from
 * real market data or pricing APIs
 */
const MOCK_SWAP_RATES: Record<string, Record<string, number>> = {
  'XLM': {
    'USDC': 0.12,
    'USDT': 0.12,
    'BTC': 0.0000027,
    'ETH': 0.000048,
    'EURC': 0.105,
    'CADT': 0.132,
    'DAI': 0.12,
    'USDP': 0.12,
  },
  'USDC': {
    'XLM': 8.33,
    'USDT': 1.0,
    'BTC': 0.000022,
    'ETH': 0.0004,
    'EURC': 0.833,
    'CADT': 1.05,
    'DAI': 1.0,
    'USDP': 1.0,
  },
  'USDT': {
    'XLM': 8.33,
    'USDC': 1.0,
    'BTC': 0.000022,
    'ETH': 0.0004,
    'EURC': 0.833,
    'CADT': 1.05,
    'DAI': 1.0,
    'USDP': 1.0,
  },
  'BTC': {
    'XLM': 370370,
    'USDC': 45000,
    'USDT': 45000,
    'ETH': 18.5,
    'EURC': 37500,
    'CADT': 47200,
    'DAI': 45000,
    'USDP': 45000,
  },
  'ETH': {
    'XLM': 20000,
    'USDC': 2500,
    'USDT': 2500,
    'BTC': 0.054,
    'EURC': 2525,
    'CADT': 3175,
    'DAI': 2500,
    'USDP': 2500,
  },
  'EURC': {
    'XLM': 9.52,
    'USDC': 1.2,
    'USDT': 1.2,
    'BTC': 0.0000266,
    'ETH': 0.000397,
    'CADT': 1.26,
    'DAI': 1.2,
    'USDP': 1.2,
  },
  'CADT': {
    'XLM': 7.58,
    'USDC': 0.95,
    'USDT': 0.95,
    'BTC': 0.0000212,
    'ETH': 0.000315,
    'EURC': 0.794,
    'DAI': 0.95,
    'USDP': 0.95,
  },
  'DAI': {
    'XLM': 8.33,
    'USDC': 1.0,
    'USDT': 1.0,
    'BTC': 0.000022,
    'ETH': 0.0004,
    'EURC': 0.833,
    'CADT': 1.05,
    'USDP': 1.0,
  },
  'USDP': {
    'XLM': 8.33,
    'USDC': 1.0,
    'USDT': 1.0,
    'BTC': 0.000022,
    'ETH': 0.0004,
    'EURC': 0.833,
    'CADT': 1.05,
    'DAI': 1.0,
  },
};

class Sep40Controller {
  // Simple in-memory cache for swap rates (5 minute TTL)
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private readonly swapRateCache = new Map<string, { rate: SwapRate; timestamp: number }>();
  
  // Cache statistics
  private readonly cacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
  };

  /**
  /**
   * Get swap rates for specified asset pairs
   * @param pairs Array of asset pairs to get rates for
   * @returns Array of swap rates
   */
  async getSwapRates(pairs: AssetPair[]): Promise<SwapRateResponse> {
    const rates: SwapRate[] = [];
    const errors: { pair: string; reason: string }[] = [];
  
    // Validate input pairs array
    if (!Array.isArray(pairs)) {
      return {
        rates: [],
        errors: [{
          pair: 'N/A',
          reason: 'Invalid input: pairs must be an array'
        }]
      };
    }
  
    for (const pair of pairs) {
      try {
        // Validate pair structure
        if (!pair || typeof pair !== 'object') {
          errors.push({
            pair: 'N/A',
            reason: 'Invalid pair object: must be an object'
          });
          continue;
        }
          
        if (!pair.sell_asset || !pair.buy_asset) {
          errors.push({
            pair: `${pair.sell_asset || 'null'}/${pair.buy_asset || 'null'}`, 
            reason: 'Missing sell_asset or buy_asset property'
          });
          continue;
        }
  
        // Validate asset codes are strings
        if (typeof pair.sell_asset !== 'string' || typeof pair.buy_asset !== 'string') {
          errors.push({
            pair: `${pair.sell_asset || 'null'}/${pair.buy_asset || 'null'}`, 
            reason: 'sell_asset and buy_asset must be strings'
          });
          continue;
        }
  
        const rate = await this.getSwapRate(pair.sell_asset, pair.buy_asset);
        if (rate) {
          rates.push(rate);
        } else {
          errors.push({
            pair: `${pair.sell_asset}/${pair.buy_asset}`, 
            reason: 'Unsupported asset pair or invalid rate calculation'
          });
        }
      } catch (error) {
        errors.push({
          pair: `${pair.sell_asset || 'unknown'}/${pair.buy_asset || 'unknown'}`, 
          reason: error instanceof Error ? error.message : 'Unknown error occurred'
        });
      }
    }
  
    // Ensure response is always consistent
    return {
      rates,
      errors: errors
    };
  }

  /**
   * Get swap rate for a single asset pair
   * @param sellAsset Asset code to sell
   * @param buyAsset Asset code to buy
   * @returns Swap rate or null if not available
   */
  private normalizeAssetCode(assetCode: string): string | null {
    if (!assetCode || typeof assetCode !== 'string') {
      return null;
    }
    
    // Trim whitespace and convert to uppercase
    let normalized = assetCode.trim().toUpperCase();
    
    // Handle asset codes with periods (e.g., "EURC.USDC") by taking only the first part
    if (normalized.includes('.')) {
      normalized = normalized.split('.')[0];
    }
    
    // Remove any non-alphanumeric characters (except underscores)
    normalized = normalized.replace(/[^A-Z0-9_]/g, '');
    
    // Additional validation for common asset code patterns
    // Allow 3-12 character asset codes (standard for most stablecoins)
    if (normalized.length < 3 || normalized.length > 12) {
      return null;
    }
    
    // Validate that it's not empty after cleaning
    if (!normalized) {
      return null;
    }
    
    return normalized;
  }

  private async getSwapRate(sellAsset: string, buyAsset: string): Promise<SwapRate | null> {
    const sellCode = this.normalizeAssetCode(sellAsset);
    const buyCode = this.normalizeAssetCode(buyAsset);
    
    if (!sellCode || !buyCode) {
      return null;
    }
    
    const cacheKey = `${sellCode}/${buyCode}`;

    // Check cache first
    const cached = this.swapRateCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      this.cacheStats.hits++;
      return cached.rate;
    }
    
    this.cacheStats.misses++;

    // Validate asset codes
    if (!sellCode || !buyCode || sellCode === buyCode) {
      return null;
    }

    // Get rate from mock data or calculate inverse
    let rate = MOCK_SWAP_RATES[sellCode]?.[buyCode];

    if (!rate) {
      // Try to calculate inverse rate with higher precision
      const inverseRate = MOCK_SWAP_RATES[buyCode]?.[sellCode];
      if (inverseRate) {
        // Use more precise calculation for inverse rates
        // Avoid direct 1/inverseRate division to prevent precision loss
        rate = Math.pow(inverseRate, -1);
        
        // Additional validation for inverse rate calculation
        if (isNaN(rate) || !isFinite(rate)) {
          logger.warn('Invalid inverse rate calculation', { 
            sellAsset: sellCode, 
            buyAsset: buyCode, 
            inverseRate 
          });
          return null;
        }
      } else {
        return null;
      }
    }

    // Calculate appropriate decimal precision based on rate magnitude
    let decimals = 7;
    if (rate < 0.001) {
      decimals = 10;
    } else if (rate < 0.01) {
      decimals = 9;
    } else if (rate < 0.1) {
      decimals = 8;
    } else if (rate >= 1000) {
      decimals = 2;
    } else if (rate >= 100) {
      decimals = 3;
    } else if (rate >= 10) {
      decimals = 4;
    }
    
    // Validate rate is reasonable (prevent extreme values)
    if (rate <= 0 || rate > 1000000) {
      logger.warn('Invalid swap rate detected', { 
        sellAsset: sellCode, 
        buyAsset: buyCode, 
        rate 
      });
      return null;
    }
    
    // Check for potential floating-point precision issues with very small rates
    if (rate < 1e-10) {
      logger.warn('Extremely small swap rate detected - potential precision loss', { 
        sellAsset: sellCode, 
        buyAsset: buyCode, 
        rate 
      });
    }
    
    // Check for potential precision issues with very large rates
    if (rate > 100000) {
      logger.warn('Very large swap rate detected - potential precision loss', { 
        sellAsset: sellCode, 
        buyAsset: buyCode, 
        rate 
      });
    }
    
    // Use proper decimal arithmetic to avoid string-based rounding errors
    // Multiply by 10^decimals, round, then divide back
    const multiplier = Math.pow(10, decimals);
    const roundedRate = Math.round(rate * multiplier) / multiplier;
    
    const rateObj = {
      sell_asset: sellCode,
      buy_asset: buyCode,
      rate: roundedRate,
      decimals,
    };

    // Store in cache
    this.swapRateCache.set(cacheKey, { rate: rateObj, timestamp: Date.now() });
    this.cacheStats.size = this.swapRateCache.size;

    return rateObj;
  }

  /**
   * Get all supported asset pairs
   * @returns Array of all supported asset pairs
   */
  async getSupportedPairs(): Promise<AssetPair[]> {
    try {
      const assets = Object.keys(MOCK_SWAP_RATES);
      const pairs: AssetPair[] = [];

      for (const sellAsset of assets) {
        if (!MOCK_SWAP_RATES[sellAsset]) continue;
        
        for (const buyAsset of Object.keys(MOCK_SWAP_RATES[sellAsset])) {
          pairs.push({
            sell_asset: sellAsset,
            buy_asset: buyAsset,
          });
        }
      }

      return pairs;
    } catch (error) {
      logger.error('Error getting supported pairs', { 
        error: error instanceof Error ? error.message : 'unknown error' 
      });
      return [];
    }
  }

  /**
   * Get cache statistics for monitoring
   * @returns Cache statistics object
   */
  getCacheStats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    const hitRate = total > 0 ? (this.cacheStats.hits / total) : 0;
    
    return {
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses,
      size: this.cacheStats.size,
      hitRate: parseFloat(hitRate.toFixed(3)),
    };
  }

  /**
   * Update mock swap rate (for testing/admin purposes)
   * @param sellAsset Asset code to sell
   * @param buyAsset Asset code to buy
   * @param rate New swap rate
   */
  updateSwapRate(sellAsset: string, buyAsset: string, rate: number): void {
    const sellCode = sellAsset.toUpperCase();
    const buyCode = buyAsset.toUpperCase();

    if (!MOCK_SWAP_RATES[sellCode]) {
      MOCK_SWAP_RATES[sellCode] = {};
    }

    MOCK_SWAP_RATES[sellCode][buyCode] = rate;
    
    // Invalidate cache for this pair and its inverse
    const cacheKey = `${sellCode}/${buyCode}`;
    const inverseCacheKey = `${buyCode}/${sellCode}`;
    this.swapRateCache.delete(cacheKey);
    this.swapRateCache.delete(inverseCacheKey);
  }

  /**
   * Clear the entire cache
   */
  clearCache(): void {
    this.swapRateCache.clear();
    this.cacheStats.hits = 0;
    this.cacheStats.misses = 0;
    this.cacheStats.size = 0;
  }
}

// Export singleton instance
export const sep40Controller = new Sep40Controller();

// Export cache statistics and management functions for testing
export const getCacheStats = () => sep40Controller.getCacheStats();
export const clearCache = () => sep40Controller.clearCache();
