import request from 'supertest';
import app from '../../index';

describe('SEP-40 Routes', () => {
  describe('POST /sep40/rates', () => {
    it('should return swap rates for valid pairs', async () => {
      const response = await request(app)
        .post('/sep40/rates')
        .send({
          pairs: [
            { sell_asset: 'XLM', buy_asset: 'USDC' },
            { sell_asset: 'USDC', buy_asset: 'XLM' },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('rates');
      expect(Array.isArray(response.body.rates)).toBe(true);
      expect(response.body.rates.length).toBe(2);
      expect(response.body.rates[0]).toHaveProperty('sell_asset');
      expect(response.body.rates[0]).toHaveProperty('buy_asset');
      expect(response.body.rates[0]).toHaveProperty('rate');
      expect(response.body.rates[0]).toHaveProperty('decimals');
    });

    it('should return 400 for missing pairs', async () => {
      const response = await request(app)
        .post('/sep40/rates')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('invalid_request');
    });

    it('should return 400 for empty pairs array', async () => {
      const response = await request(app)
        .post('/sep40/rates')
        .send({ pairs: [] });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for invalid pair structure', async () => {
      const response = await request(app)
        .post('/sep40/rates')
        .send({
          pairs: [
            { sell_asset: 'XLM' }, // Missing buy_asset
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should handle case-insensitive asset codes', async () => {
      const response = await request(app)
        .post('/sep40/rates')
        .send({
          pairs: [
            { sell_asset: 'xlm', buy_asset: 'usdc' },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.rates[0].sell_asset).toBe('XLM');
      expect(response.body.rates[0].buy_asset).toBe('USDC');
    });
  });

  describe('GET /sep40/pairs', () => {
    it('should return all supported asset pairs', async () => {
      const response = await request(app)
        .get('/sep40/pairs');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('pairs');
      expect(Array.isArray(response.body.pairs)).toBe(true);
      expect(response.body.pairs.length).toBeGreaterThan(0);

      // Verify structure
      response.body.pairs.forEach((pair: any) => {
        expect(pair).toHaveProperty('sell_asset');
        expect(pair).toHaveProperty('buy_asset');
      });
    });
  });
});
