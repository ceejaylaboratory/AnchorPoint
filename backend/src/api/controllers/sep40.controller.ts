import prisma from '../../lib/prisma';

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
  },
  'USDC': {
    'XLM': 8.33,
    'USDT': 1.0,
    'BTC': 0.000022,
    'ETH': 0.0004,
  },
  'USDT': {
    'XLM': 8.33,
    'USDC': 1.0,
    'BTC': 0.000022,
    'ETH': 0.0004,
  },
  'BTC': {
    'XLM': 370370,
    'USDC': 45000,
    'USDT': 45000,
    'ETH': 18.5,
  },
  'ETH': {
    'XLM': 20000,
    'USDC': 2500,
    'USDT': 2500,
    'BTC': 0.054,
  },
};

class Sep40Controller {
  /**
   * Get swap rates for specified asset pairs
   * @param pairs Array of asset pairs to get rates for
   * @returns Array of swap rates
   */
  async getSwapRates(pairs: AssetPair[]): Promise<SwapRateResponse> {
    const rates: SwapRate[] = [];

    for (const pair of pairs) {
      const rate = await this.getSwapRate(pair.sell_asset, pair.buy_asset);
      if (rate) {
        rates.push(rate);
      }
    }

    return { rates };
  }

  /**
   * Get swap rate for a single asset pair
   * @param sellAsset Asset code to sell
   * @param buyAsset Asset code to buy
   * @returns Swap rate or null if not available
   */
  private async getSwapRate(sellAsset: string, buyAsset: string): Promise<SwapRate | null> {
    const sellCode = sellAsset.toUpperCase();
    const buyCode = buyAsset.toUpperCase();

    // Validate asset codes
    if (!sellCode || !buyCode || sellCode === buyCode) {
      return null;
    }

    // Get rate from mock data or calculate inverse
    let rate = MOCK_SWAP_RATES[sellCode]?.[buyCode];

    if (!rate) {
      // Try to calculate inverse rate
      const inverseRate = MOCK_SWAP_RATES[buyCode]?.[sellCode];
      if (inverseRate) {
        rate = 1 / inverseRate;
      } else {
        return null;
      }
    }

    return {
      sell_asset: sellCode,
      buy_asset: buyCode,
      rate: parseFloat(rate.toFixed(7)),
      decimals: 7,
    };
  }

  /**
   * Get all supported asset pairs
   * @returns Array of all supported asset pairs
   */
  async getSupportedPairs(): Promise<AssetPair[]> {
    const assets = Object.keys(MOCK_SWAP_RATES);
    const pairs: AssetPair[] = [];

    for (const sellAsset of assets) {
      for (const buyAsset of Object.keys(MOCK_SWAP_RATES[sellAsset])) {
        pairs.push({
          sell_asset: sellAsset,
          buy_asset: buyAsset,
        });
      }
    }

    return pairs;
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
  }
}

// Export singleton instance
export const sep40Controller = new Sep40Controller();
