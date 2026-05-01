import { sep40Controller } from './sep40.controller';

describe('Sep40Controller', () => {
  describe('getSwapRates', () => {
    it('should return swap rates for valid asset pairs', async () => {
      const pairs = [
        { sell_asset: 'XLM', buy_asset: 'USDC' },
        { sell_asset: 'USDC', buy_asset: 'XLM' },
      ];

      const result = await sep40Controller.getSwapRates(pairs);

      expect(result.rates).toHaveLength(2);
      expect(result.rates[0].sell_asset).toBe('XLM');
      expect(result.rates[0].buy_asset).toBe('USDC');
      expect(result.rates[0].rate).toBe(0.12);
      expect(result.rates[0].decimals).toBe(7);
    });

    it('should handle empty pairs array', async () => {
      const pairs: any[] = [];
      const result = await sep40Controller.getSwapRates(pairs);

      expect(result.rates).toHaveLength(0);
    });

    it('should filter out invalid pairs', async () => {
      const pairs = [
        { sell_asset: 'XLM', buy_asset: 'XLM' }, // Same asset
        { sell_asset: 'XLM', buy_asset: 'USDC' }, // Valid
      ];

      const result = await sep40Controller.getSwapRates(pairs);

      expect(result.rates).toHaveLength(1);
      expect(result.rates[0].sell_asset).toBe('XLM');
      expect(result.rates[0].buy_asset).toBe('USDC');
    });

    it('should handle case-insensitive asset codes', async () => {
      const pairs = [
        { sell_asset: 'xlm', buy_asset: 'usdc' },
      ];

      const result = await sep40Controller.getSwapRates(pairs);

      expect(result.rates).toHaveLength(1);
      expect(result.rates[0].sell_asset).toBe('XLM');
      expect(result.rates[0].buy_asset).toBe('USDC');
    });

    it('should calculate inverse rates when direct rate not available', async () => {
      const pairs = [
        { sell_asset: 'USDC', buy_asset: 'XLM' },
      ];

      const result = await sep40Controller.getSwapRates(pairs);

      expect(result.rates).toHaveLength(1);
      expect(result.rates[0].rate).toBeCloseTo(8.33, 1);
    });
  });

  describe('getSupportedPairs', () => {
    it('should return all supported asset pairs', async () => {
      const pairs = await sep40Controller.getSupportedPairs();

      expect(Array.isArray(pairs)).toBe(true);
      expect(pairs.length).toBeGreaterThan(0);

      // Verify structure
      pairs.forEach((pair) => {
        expect(pair).toHaveProperty('sell_asset');
        expect(pair).toHaveProperty('buy_asset');
        expect(typeof pair.sell_asset).toBe('string');
        expect(typeof pair.buy_asset).toBe('string');
      });
    });
  });

  describe('updateSwapRate', () => {
    it('should update an existing swap rate', async () => {
      const newRate = 0.15;
      sep40Controller.updateSwapRate('XLM', 'USDC', newRate);

      const pairs = [{ sell_asset: 'XLM', buy_asset: 'USDC' }];
      const result = await sep40Controller.getSwapRates(pairs);

      expect(result.rates[0].rate).toBe(newRate);

      // Reset to original value
      sep40Controller.updateSwapRate('XLM', 'USDC', 0.12);
    });

    it('should create new asset pair if not exists', async () => {
      const newRate = 0.5;
      sep40Controller.updateSwapRate('NEW', 'ASSET', newRate);

      const pairs = [{ sell_asset: 'NEW', buy_asset: 'ASSET' }];
      const result = await sep40Controller.getSwapRates(pairs);

      expect(result.rates).toHaveLength(1);
      expect(result.rates[0].rate).toBe(newRate);
    });
  });
});
