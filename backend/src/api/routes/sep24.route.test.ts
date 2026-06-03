import express from 'express';
import request from 'supertest';

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomUUID: jest.fn(() => '00000000-0000-0000-0000-000000000000')
  };
});

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    quote: {
      findUnique: jest.fn(),
    },
  },
}));

import sep24Router from './sep24.route';

jest.setTimeout(15000);

describe('SEP-24 Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/', sep24Router);

  const baseUrl = 'http://localhost:4100';
  const validAccount = 'GCM5WPR4DDR24FSAX5LIEM4J7AI3KOWJYANSXEPKYXCSZOTAYXE75AFN';

  beforeEach(() => {
    process.env.INTERACTIVE_URL = baseUrl;
  });

  afterEach(() => {
    delete process.env.INTERACTIVE_URL;
  });

  describe('POST /transactions/deposit/interactive', () => {
    it('returns 400 when asset_code is missing', async () => {
      const res = await request(app)
        .post('/transactions/deposit/interactive')
        .send({ account: validAccount });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('asset_code is required');
    });

    it('returns 400 when asset_code is not supported', async () => {
      const res = await request(app)
        .post('/transactions/deposit/interactive')
        .send({ asset_code: 'DOGE' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('Asset DOGE is not supported');
      expect(res.body.error).toContain('Supported assets: USDC, USD');
    });

    it('returns an interactive URL for supported assets (with optional params)', async () => {
      const res = await request(app)
        .post('/transactions/deposit/interactive')
        .send({
          asset_code: 'usdc',
          account: validAccount,
          amount: '12.50',
          lang: 'fr'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.type).toBe('interactive_customer_info_needed');
      expect(res.body.id).toBe('00000000-0000-0000-0000-000000000000');

      const parsed = new URL(res.body.url);
      expect(parsed.pathname).toBe('/kyc-deposit');
      expect(parsed.searchParams.get('transaction_id')).toBe(res.body.id);
      expect(parsed.searchParams.get('asset_code')).toBe('USDC');
      expect(parsed.searchParams.get('account')).toBe(validAccount);
      expect(parsed.searchParams.get('amount')).toBe('12.50');
      expect(parsed.searchParams.get('lang')).toBe('fr');
    });

    it.each([
      ['plain invalid string', 'INVALID_ADDRESS'],
      ['secret seed-like value', `S${validAccount.slice(1)}`],
      ['padded public key', `${validAccount} `],
      ['checksum mismatch', `${validAccount.slice(0, -1)}A`],
      ['contract address-like value', `C${validAccount.slice(1)}`],
    ])('returns 400 when account is %s', async (_caseName, account) => {
      const res = await request(app)
        .post('/transactions/deposit/interactive')
        .send({
          asset_code: 'USDC',
          account,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('account must be a valid Stellar public key');
      expect(res.body.error).not.toContain(account);
    });

    it('defaults lang to en when omitted', async () => {
      const res = await request(app)
        .post('/transactions/deposit/interactive')
        .send({
          asset_code: 'USDC'
        });

      const parsed = new URL(res.body.url);
      expect(parsed.searchParams.get('lang')).toBe('en');
    });
  });

  describe('POST /transactions/withdraw/interactive', () => {
    it('returns 400 when asset_code is missing', async () => {
      const res = await request(app)
        .post('/transactions/withdraw/interactive')
        .send({ account: validAccount });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('asset_code is required');
    });

    it('returns 400 when asset_code is not supported', async () => {
      const res = await request(app)
        .post('/transactions/withdraw/interactive')
        .send({ asset_code: 'DOGE' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('Asset DOGE is not supported');
      expect(res.body.error).toContain('Supported assets: USDC, USD');
    });

    it('returns an interactive URL for supported assets', async () => {
      const res = await request(app)
        .post('/transactions/withdraw/interactive')
        .send({
          asset_code: 'USD',
          account: validAccount,
          amount: '1'
        });

      expect(res.statusCode).toBe(200);
      const parsed = new URL(res.body.url);
      expect(parsed.pathname).toBe('/kyc-withdraw');
      expect(parsed.searchParams.get('asset_code')).toBe('USD');
      expect(parsed.searchParams.get('account')).toBe(validAccount);
      expect(parsed.searchParams.get('amount')).toBe('1');
    });

    it.each([
      ['plain invalid string', 'INVALID_ADDRESS'],
      ['secret seed-like value', `S${validAccount.slice(1)}`],
      ['padded public key', ` ${validAccount}`],
      ['muxed account-like value', `M${validAccount.slice(1)}`],
    ])('returns 400 when account is %s', async (_caseName, account) => {
      const res = await request(app)
        .post('/transactions/withdraw/interactive')
        .send({
          asset_code: 'USD',
          account,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('account must be a valid Stellar public key');
      expect(res.body.error).not.toContain(account);
    });
  });
});
