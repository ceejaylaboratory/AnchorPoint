import prisma from '../../lib/prisma';

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

export interface QuoteResponse extends PriceQuote {
  id: string;
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
 * Mock price data - fallback if API fails
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
  private async getLivePrice(assetCode: string): Promise<number> {
    const mapping: Record<string, string> = {
      'XLM': 'stellar',
      'USDC': 'usd-coin',
      'USDT': 'tether',
      'BTC': 'bitcoin',
      'ETH': 'ethereum'
    };
    
    const id = mapping[assetCode.toUpperCase()];
    if (!id) return MOCK_PRICES[assetCode.toUpperCase()] || 1.0;

    try {
      const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
      if (!response.ok) throw new Error('API limit or error');
      const data = await response.json();
      return data[id]?.usd || MOCK_PRICES[assetCode.toUpperCase()];
    } catch (error) {
      console.warn(`Failed to fetch live price for ${assetCode}, using fallback.`);
      return MOCK_PRICES[assetCode.toUpperCase()];
    }
  }

  async getPriceQuote(
    sourceAsset: string,
    sourceAmount: number,
    destinationAsset: string,
    context?: string,
  ): Promise<PriceQuote> {
    const sourcePriceUSD = await this.getLivePrice(sourceAsset);
    const destPriceUSD = await this.getLivePrice(destinationAsset);

    const crossRate = sourcePriceUSD / destPriceUSD;
    const destinationAmount = sourceAmount * crossRate;

    const quote: PriceQuote = {
      source_asset: sourceAsset.toUpperCase(),
      source_amount: sourceAmount,
      destination_asset: destinationAsset.toUpperCase(),
      destination_amount: parseFloat(destinationAmount.toFixed(7)),
      price: parseFloat(crossRate.toFixed(7)),
    };

    if (context) {
      quote.context = context;
    }

    return quote;
  }

  async createQuote(
    sourceAsset: string,
    sourceAmount: number,
    destinationAsset: string,
    context?: string,
  ): Promise<QuoteResponse> {
    const indicativeQuote = await this.getPriceQuote(sourceAsset, sourceAmount, destinationAsset, context);
    
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

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

  async getSupportedAssets(): Promise<AssetInfo[]> {
    return SUPPORTED_ASSETS;
  }

  addSupportedAsset(asset: AssetInfo): void {
    const existingIndex = SUPPORTED_ASSETS.findIndex(
      (a) => a.code === asset.code && a.issuer === asset.issuer
    );

    if (existingIndex !== -1) {
      SUPPORTED_ASSETS[existingIndex] = asset;
    } else {
      SUPPORTED_ASSETS.push(asset);
    }
  }

  updateMockPrice(assetCode: string, priceUSD: number): void {
    MOCK_PRICES[assetCode.toUpperCase()] = priceUSD;
  }
}

// Export singleton instance
export const sep38Controller = new Sep38Controller();
