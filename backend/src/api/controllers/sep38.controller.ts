

/**
 * Interface for price quote response as per SEP-38
 */
interface PriceQuote {
  source_asset: string;
  source_amount: number;
  destination_asset: string;
  destination_amount: number;
  price: number;
  expiration_time?: number;
  context?: string;
}

/**
 * Interface for supported asset information
 */
interface AssetInfo {
  code: string;
  issuer?: string;
  asset_type: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  name: string;
  description?: string;
  decimals: number;
}

/**
 * Mock price data - In production, this would come from an oracle or external API
 */
const MOCK_PRICES: Record<string, number> = {
  XLM: 0.12, // USD
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
];

class Sep38Controller {
  /**
   * Get a price quote for exchanging one asset for another
   * 
   * @param sourceAsset - The asset to sell
   * @param sourceAmount - Amount of source asset to sell
   * @param destinationAsset - The asset to buy
   * @param context - Optional context (e.g., "SEP-24")
   * @returns Price quote object
   */
  async getPriceQuote(
    sourceAsset: string,
    sourceAmount: number,
    destinationAsset: string,
    context?: string,
  ): Promise<PriceQuote> {
    // Validate assets are supported
    if (!MOCK_PRICES[sourceAsset.toUpperCase()]) {
      throw new Error(`Unsupported source asset: ${sourceAsset}`);
    }

    if (!MOCK_PRICES[destinationAsset.toUpperCase()]) {
      throw new Error(`Unsupported destination asset: ${destinationAsset}`);
    }

    // Calculate price based on USD conversion rates
    const sourcePriceUSD = MOCK_PRICES[sourceAsset.toUpperCase()];
    const destPriceUSD = MOCK_PRICES[destinationAsset.toUpperCase()];

    // Cross rate calculation
    const crossRate = sourcePriceUSD / destPriceUSD;
    const destinationAmount = sourceAmount * crossRate;

    const quote: PriceQuote = {
      source_asset: sourceAsset.toUpperCase(),
      source_amount: sourceAmount,
      destination_asset: destinationAsset.toUpperCase(),
      destination_amount: parseFloat(destinationAmount.toFixed(7)),
      price: parseFloat(crossRate.toFixed(7)),
      expiration_time: Math.floor(Date.now() / 1000) + 60, // Quote valid for 60 seconds
    };

    if (context) {
      quote.context = context;
    }

    return quote;
  }

  /**
   * Get list of supported assets
   * 
   * @returns Array of supported asset information
   */
  async getSupportedAssets(): Promise<AssetInfo[]> {
    return SUPPORTED_ASSETS;
  }

  /**
   * Add a new supported asset (for testing/admin purposes)
   * This would typically be protected by authentication in production
   */
  addSupportedAsset(asset: AssetInfo): void {
    // Check if asset already exists
    const existingIndex = SUPPORTED_ASSETS.findIndex(
      (a) => a.code === asset.code && a.issuer === asset.issuer
    );

    if (existingIndex !== -1) {
      // Update existing asset
      SUPPORTED_ASSETS[existingIndex] = asset;
    } else {
      // Add new asset
      SUPPORTED_ASSETS.push(asset);
    }
  }

  /**
   * Update mock price (for testing purposes)
   */
  updateMockPrice(assetCode: string, priceUSD: number): void {
    MOCK_PRICES[assetCode.toUpperCase()] = priceUSD;
  }
}

// Export singleton instance
export const sep38Controller = new Sep38Controller();
