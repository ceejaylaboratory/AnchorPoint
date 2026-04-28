import { sep38Controller } from './sep38.controller';

describe('SEP-38 Controller', () => {
  beforeEach(() => {
    // Reset mock prices to known state before each test
    sep38Controller.updateMockPrice('XLM', 0.12);
    sep38Controller.updateMockPrice('USDC', 1.0);
    sep38Controller.updateMockPrice('USDT', 1.0);
    sep38Controller.updateMockPrice('BTC', 45000.0);
    sep38Controller.updateMockPrice('ETH', 2500.0);
  });

  describe('getPriceQuote', () => {
    it('should calculate correct price quote for USDC to XLM', async () => {
      const quote = await sep38Controller.getPriceQuote('USDC', 100, 'XLM');

      expect(quote.source_asset).toBe('USDC');
      expect(quote.source_amount).toBe(100);
      expect(quote.destination_asset).toBe('XLM');
      expect(quote.destination_amount).toBeCloseTo(833.33, 1);
      expect(quote.price).toBeCloseTo(8.33, 1);
    });

    it('should calculate correct price quote for XLM to USDC', async () => {
      const quote = await sep38Controller.getPriceQuote('XLM', 1000, 'USDC');

      expect(quote.source_asset).toBe('XLM');
      expect(quote.source_amount).toBe(1000);
      expect(quote.destination_asset).toBe('USDC');
      expect(quote.destination_amount).toBeCloseTo(120, 1);
      expect(quote.price).toBeLessThan(1);
    });

    it('should handle same-asset quotes', async () => {
      const quote = await sep38Controller.getPriceQuote('USDC', 100, 'USDC');

      expect(quote.source_asset).toBe('USDC');
      expect(quote.destination_asset).toBe('USDC');
      expect(quote.destination_amount).toBe(100);
      expect(quote.price).toBe(1);
    });

    it('should include expiration_time in quote', async () => {
      const beforeQuote = Math.floor(Date.now() / 1000);
      const quote = await sep38Controller.getPriceQuote('USDC', 100, 'XLM');
      const afterQuote = Math.floor(Date.now() / 1000);

      expect(quote.expiration_time).toBeDefined();
      expect(quote.expiration_time).toBeGreaterThanOrEqual(beforeQuote + 60);
      expect(quote.expiration_time).toBeLessThanOrEqual(afterQuote + 60);
    });

    it('should include context when provided', async () => {
      const quote = await sep38Controller.getPriceQuote('USDC', 100, 'XLM', 'SEP-24');

      expect(quote.context).toBe('SEP-24');
    });

    it('should omit context from quote when not provided', async () => {
      const quote = await sep38Controller.getPriceQuote('USDC', 100, 'XLM');

      expect(quote.context).toBeUndefined();
    });

    it('should handle decimal source amounts correctly', async () => {
      const quote = await sep38Controller.getPriceQuote('USDC', 50.5, 'XLM');

      expect(quote.source_amount).toBe(50.5);
      expect(quote.destination_amount).toBeCloseTo(420.83, 1);
    });

    it('should throw error for unsupported source asset', async () => {
      await expect(sep38Controller.getPriceQuote('INVALID', 100, 'USDC')).rejects.toThrow(
        'Unsupported source asset'
      );
    });

    it('should throw error for unsupported destination asset', async () => {
      await expect(sep38Controller.getPriceQuote('USDC', 100, 'INVALID')).rejects.toThrow(
        'Unsupported destination asset'
      );
    });

    it('should be case-insensitive for asset codes', async () => {
      const quote1 = await sep38Controller.getPriceQuote('usdc', 100, 'xlm');
      const quote2 = await sep38Controller.getPriceQuote('USDC', 100, 'XLM');

      expect(quote1.destination_amount).toBe(quote2.destination_amount);
      expect(quote1.price).toBe(quote2.price);
    });

    it('should handle BTC to ETH conversion', async () => {
      const quote = await sep38Controller.getPriceQuote('BTC', 1, 'ETH');

      expect(quote.source_asset).toBe('BTC');
      expect(quote.destination_asset).toBe('ETH');
      expect(quote.destination_amount).toBeCloseTo(18, 0); // 45000 / 2500 = 18
    });
  });

  describe('getSupportedAssets', () => {
    it('should return list of supported assets', async () => {
      const assets = await sep38Controller.getSupportedAssets();

      expect(Array.isArray(assets)).toBe(true);
      expect(assets.length).toBeGreaterThan(0);
    });

    it('should include XLM in supported assets', async () => {
      const assets = await sep38Controller.getSupportedAssets();
      const xlmAsset = assets.find(a => a.code === 'XLM');

      expect(xlmAsset).toBeDefined();
      expect(xlmAsset?.asset_type).toBe('native');
    });

    it('should include USDC in supported assets', async () => {
      const assets = await sep38Controller.getSupportedAssets();
      const usdcAsset = assets.find(a => a.code === 'USDC');

      expect(usdcAsset).toBeDefined();
      expect(usdcAsset?.asset_type).toBe('credit_alphanum4');
      expect(usdcAsset?.issuer).toBeDefined();
    });

    it('should include asset details in each asset object', async () => {
      const assets = await sep38Controller.getSupportedAssets();
      const asset = assets[0];

      expect(asset).toHaveProperty('code');
      expect(asset).toHaveProperty('asset_type');
      expect(asset).toHaveProperty('name');
      expect(asset).toHaveProperty('decimals');
      expect(asset).toHaveProperty('description');
    });

    it('should have decimals set to 7 for all assets', async () => {
      const assets = await sep38Controller.getSupportedAssets();

      assets.forEach(asset => {
        expect(asset.decimals).toBe(7);
      });
    });
  });

  describe('addSupportedAsset', () => {
    it('should add a new supported asset', async () => {
      const newAsset = {
        code: 'TEST',
        asset_type: 'credit_alphanum4' as const,
        name: 'Test Asset',
        decimals: 7,
        description: 'Test asset for unit testing',
        issuer: 'GTEST123'
      };

      sep38Controller.addSupportedAsset(newAsset);
      const assets = await sep38Controller.getSupportedAssets();
      const addedAsset = assets.find(a => a.code === 'TEST');

      expect(addedAsset).toBeDefined();
      expect(addedAsset?.name).toBe('Test Asset');
    });

    it('should update existing asset when adding with same code and issuer', async () => {
      const initialAssets = await sep38Controller.getSupportedAssets();
      const xlmAsset = initialAssets.find(a => a.code === 'XLM');
      
      const updatedAsset = {
        code: 'XLM',
        asset_type: 'native' as const,
        name: 'Updated Stellar Lumens',
        decimals: 7,
        description: 'Updated description'
      };

      sep38Controller.addSupportedAsset(updatedAsset);
      const updatedAssets = await sep38Controller.getSupportedAssets();
      const modifiedXlm = updatedAssets.find(a => a.code === 'XLM');

      expect(modifiedXlm?.name).toBe('Updated Stellar Lumens');
      expect(modifiedXlm?.description).toBe('Updated description');
    });

    it('should allow same asset code with different issuer', async () => {
      const newAsset = {
        code: 'USDC',
        asset_type: 'credit_alphanum4' as const,
        name: 'USDC (Alternative Issuer)',
        decimals: 7,
        issuer: 'GALTERNATIVE123'
      };

      sep38Controller.addSupportedAsset(newAsset);
      const assets = await sep38Controller.getSupportedAssets();
      const usdcAssets = assets.filter(a => a.code === 'USDC');

      expect(usdcAssets.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('updateMockPrice', () => {
    it('should update price for existing asset', async () => {
      sep38Controller.updateMockPrice('XLM', 0.25);
      const quote = await sep38Controller.getPriceQuote('XLM', 100, 'USDC');

      expect(quote.destination_amount).toBeCloseTo(25, 1);
    });

    it('should be case-insensitive when updating prices', async () => {
      sep38Controller.updateMockPrice('xlm', 0.50);
      const quote = await sep38Controller.getPriceQuote('XLM', 100, 'USDC');

      expect(quote.destination_amount).toBeCloseTo(50, 1);
    });

    it('should allow adding price for new asset', async () => {
      sep38Controller.updateMockPrice('NEWCOIN', 99.99);
      const newAsset = {
        code: 'NEWCOIN',
        asset_type: 'credit_alphanum4' as const,
        name: 'New Coin',
        decimals: 7
      };

      sep38Controller.addSupportedAsset(newAsset);
      const quote = await sep38Controller.getPriceQuote('USDC', 100, 'NEWCOIN');

      expect(quote.destination_amount).toBeCloseTo(1, 0);
    });

    it('should affect future price calculations', async () => {
      const originalQuote = await sep38Controller.getPriceQuote('USDC', 100, 'BTC');
      
      sep38Controller.updateMockPrice('BTC', 90000.0);
      const newQuote = await sep38Controller.getPriceQuote('USDC', 100, 'BTC');

      expect(newQuote.destination_amount).toBeLessThan(originalQuote.destination_amount);
    });
  });
});
