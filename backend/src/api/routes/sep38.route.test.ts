import request from 'supertest';
import express from 'express';
import sep38Router from './sep38.route';

jest.mock('../controllers/sep38.controller', () => ({
  sep38Controller: {
    getPriceQuote: jest.fn(async (sourceAsset: string, sourceAmount: number, destinationAsset: string, context?: string) => ({
      ...(sourceAsset === 'INVALID' || destinationAsset === 'INVALID'
        ? (() => { throw new Error('Unsupported asset'); })()
        : {}),
      source_asset: sourceAsset,
      source_amount: sourceAmount,
      destination_asset: destinationAsset,
      destination_amount: sourceAsset.toUpperCase() === destinationAsset.toUpperCase() ? sourceAmount : sourceAsset === 'USDC' ? sourceAmount / 0.12 : sourceAmount * 0.12,
      price: sourceAsset === 'USDC' && destinationAsset === 'XLM' ? 8.33 : 0.12,
      expiration_time: Math.floor(Date.now() / 1000) + 60,
      context,
      cached: false,
    })),
    createQuote: jest.fn(async (sourceAsset: string, sourceAmount: number, destinationAsset: string, context?: string) => ({
      ...(sourceAsset === 'INVALID' || destinationAsset === 'INVALID'
        ? (() => { throw new Error('Unsupported asset'); })()
        : {}),
      id: 'quote-123',
      source_asset: sourceAsset,
      source_amount: sourceAmount,
      destination_asset: destinationAsset,
      destination_amount: sourceAmount / 0.12,
      price: 8.33,
      expiration_time: Math.floor(Date.now() / 1000) + 300,
      context,
    })),
    getSupportedAssets: jest.fn(async () => ([
      { code: 'XLM', asset_type: 'native', name: 'Stellar Lumens', decimals: 7 },
      { code: 'USDC', asset_type: 'credit_alphanum4', issuer: 'issuer', name: 'USD Coin', decimals: 7 },
    ])),
  },
}));

const app = express();
app.use(express.json());
app.use('/sep38', sep38Router);

describe('SEP-38 Price Quotes API', () => {
  describe('GET /sep38/price', () => {
    it('should return price quote for valid assets', async () => {
      const response = await request(app)
        .get('/sep38/price')
        .query({
          source_asset: 'USDC',
          source_amount: 100,
          destination_asset: 'XLM',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('source_asset', 'USDC');
      expect(response.body).toHaveProperty('source_amount', 100);
      expect(response.body).toHaveProperty('destination_asset', 'XLM');
      expect(response.body).toHaveProperty('destination_amount');
      expect(response.body).toHaveProperty('price');
      expect(response.body.destination_amount).toBeGreaterThan(0);
    });

    it('should handle XLM to USDC conversion', async () => {
      const response = await request(app)
        .get('/sep38/price')
        .query({
          source_asset: 'XLM',
          source_amount: 1000,
          destination_asset: 'USDC',
        });

      expect(response.status).toBe(200);
      expect(response.body.source_asset).toBe('XLM');
      expect(response.body.destination_asset).toBe('USDC');
      expect(response.body.price).toBeLessThan(1); // XLM is worth less than USDC
    });

    it('should return error for missing parameters', async () => {
      const response = await request(app)
        .get('/sep38/price')
        .query({
          source_asset: 'USDC',
          // missing source_amount and destination_asset
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'missing_required_params');
    });

    it('should handle unsupported asset', async () => {
      const response = await request(app)
        .get('/sep38/price')
        .query({
          source_asset: 'INVALID',
          source_amount: 100,
          destination_asset: 'USDC',
        });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
    });

    it('should include context when provided', async () => {
      const response = await request(app)
        .get('/sep38/price')
        .query({
          source_asset: 'USDC',
          source_amount: 100,
          destination_asset: 'XLM',
          context: 'SEP-24',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('context', 'SEP-24');
    });

    it('should include expiration time', async () => {
      const response = await request(app)
        .get('/sep38/price')
        .query({
          source_asset: 'USDC',
          source_amount: 100,
          destination_asset: 'XLM',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('expiration_time');
      expect(response.body.expiration_time).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  describe('POST /sep38/quote', () => {
    it('should return price quote for valid POST request', async () => {
      const response = await request(app)
        .post('/sep38/quote')
        .send({
          source_asset: 'USDC',
          source_amount: 100,
          destination_asset: 'XLM',
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('source_asset', 'USDC');
      expect(response.body.destination_amount).toBeGreaterThan(0);
    });

    it('should return error for missing body parameters', async () => {
      const response = await request(app)
        .post('/sep38/quote')
        .send({
          source_asset: 'USDC',
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'missing_required_params');
    });
  });

  describe('GET /sep38/assets', () => {
    it('should return list of supported assets', async () => {
      const response = await request(app)
        .get('/sep38/assets');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('assets');
      expect(Array.isArray(response.body.assets)).toBe(true);
      expect(response.body.assets.length).toBeGreaterThan(0);
    });

    it('should include XLM in supported assets', async () => {
      const response = await request(app)
        .get('/sep38/assets');

      expect(response.status).toBe(200);
      const xlmAsset = response.body.assets.find((a: any) => a.code === 'XLM');
      expect(xlmAsset).toBeDefined();
      expect(xlmAsset.asset_type).toBe('native');
    });

    it('should include USDC in supported assets', async () => {
      const response = await request(app)
        .get('/sep38/assets');

      expect(response.status).toBe(200);
      const usdcAsset = response.body.assets.find((a: any) => a.code === 'USDC');
      expect(usdcAsset).toBeDefined();
      expect(usdcAsset.asset_type).toBe('credit_alphanum4');
      expect(usdcAsset).toHaveProperty('issuer');
    });
  });

  describe('Price calculation accuracy', () => {
    it('should calculate correct cross rate', async () => {
      // 1 USDC = 1 USD, 1 XLM = 0.12 USD
      // So 1 USDC should equal approximately 8.33 XLM
      const response = await request(app)
        .get('/sep38/price')
        .query({
          source_asset: 'USDC',
          source_amount: 1,
          destination_asset: 'XLM',
        });

      expect(response.status).toBe(200);
      expect(response.body.destination_amount).toBeCloseTo(8.33, 2);
    });

    it('should handle decimal precision correctly', async () => {
      const response = await request(app)
        .get('/sep38/price')
        .query({
          source_asset: 'USDC',
          source_amount: 100.50,
          destination_asset: 'XLM',
        });

      expect(response.status).toBe(200);
      expect(response.body.source_amount).toBe(100.50);
      expect(typeof response.body.destination_amount).toBe('number');
    });
  });
});
