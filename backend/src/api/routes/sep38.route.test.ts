import request from 'supertest';
import express from 'express';

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    quote: {
      create: jest.fn().mockResolvedValue({
        id: 'mock-quote-id',
        sellAsset: 'USDC',
        buyAsset: 'XLM',
        sellAmount: '100',
        buyAmount: '833',
        price: '8.33',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  },
}));

import sep38Router from './sep38.route';

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

  describe('Dynamic fee calculation', () => {
    it('returns a fee field on a price quote', async () => {
      const response = await request(app)
        .get('/sep38/price')
        .query({ source_asset: 'USDC', source_amount: 100, destination_asset: 'XLM' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('fee');
      expect(typeof response.body.fee).toBe('number');
      expect(response.body.fee).toBeGreaterThanOrEqual(0);
    });

    it('applies a lower fee percent for large amounts', async () => {
      const small = await request(app)
        .get('/sep38/price')
        .query({ source_asset: 'USDC', source_amount: 100, destination_asset: 'XLM' });

      const large = await request(app)
        .get('/sep38/price')
        .query({ source_asset: 'USDC', source_amount: 200_000, destination_asset: 'XLM' });

      const smallRate = small.body.fee / small.body.source_amount;
      const largeRate = large.body.fee / large.body.source_amount;
      expect(largeRate).toBeLessThan(smallRate);
    });
  });
});
