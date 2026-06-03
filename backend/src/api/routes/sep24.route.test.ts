import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const tokenSecret = 'sep24-route-test-secret';

jest.mock('../../config/env', () => ({
  config: {
    SEP24_INTERACTIVE_URL_JWT_SECRET: tokenSecret,
    SEP24_INTERACTIVE_URL_JWT_EXPIRATION_SECONDS: 600,
    JWT_SECRET: tokenSecret,
    INTERACTIVE_URL: 'http://localhost:4100',
  },
}));

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

  const signRouteToken = (overrides: Partial<{
    transactionId: string;
    account: string;
    assetCode: string;
    amount: string;
    lang: string;
    flow: 'deposit' | 'withdraw';
  }> = {}) => jwt.sign(
    {
      sub: overrides.account ?? 'GACCOUNT',
      jti: overrides.transactionId ?? '00000000-0000-0000-0000-000000000000',
      data: {
        asset: overrides.assetCode ?? 'USDC',
        ...(overrides.amount ? { amount: overrides.amount } : {}),
        lang: overrides.lang ?? 'en',
        flow: overrides.flow ?? 'deposit',
      },
    },
    tokenSecret,
    { algorithm: 'HS256', expiresIn: 600 },
  );

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
        .send({ account: 'GACCOUNT' });

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
          account: 'GACCOUNT',
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
      expect(parsed.searchParams.get('account')).toBe('GACCOUNT');
      expect(parsed.searchParams.get('amount')).toBe('12.50');
      expect(parsed.searchParams.get('lang')).toBe('fr');
      expect(parsed.searchParams.get('token')).toEqual(expect.any(String));
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
        .send({ account: 'GACCOUNT' });

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
          account: 'GACCOUNT',
          amount: '1'
        });

      expect(res.statusCode).toBe(200);
      const parsed = new URL(res.body.url);
      expect(parsed.pathname).toBe('/kyc-withdraw');
      expect(parsed.searchParams.get('asset_code')).toBe('USD');
      expect(parsed.searchParams.get('account')).toBe('GACCOUNT');
      expect(parsed.searchParams.get('amount')).toBe('1');
      expect(parsed.searchParams.get('token')).toEqual(expect.any(String));
    });
  });

  describe('GET /interactive/validate', () => {
    it('returns 400 when token is missing', async () => {
      const res = await request(app).get('/interactive/validate');

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('token is required');
    });

    it('returns session details for a valid token', async () => {
      const token = signRouteToken({
        assetCode: 'USDC',
        amount: '12.50',
        lang: 'fr',
        flow: 'deposit',
      });

      const res = await request(app).get('/interactive/validate').query({ token });

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        transaction_id: '00000000-0000-0000-0000-000000000000',
        account: 'GACCOUNT',
        asset_code: 'USDC',
        amount: '12.50',
        lang: 'fr',
        flow: 'deposit',
      });
      expect(res.body.expires_at).toEqual(expect.any(String));
    });

    it('returns 401 for an invalid token', async () => {
      const res = await request(app)
        .get('/interactive/validate')
        .query({ token: 'invalid-token' });

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Invalid token');
    });

    it('returns 401 for an expired token', async () => {
      const expiredToken = jwt.sign(
        {
          sub: 'GACCOUNT',
          jti: '00000000-0000-0000-0000-000000000000',
          data: { asset: 'USDC', lang: 'en', flow: 'deposit' },
        },
        tokenSecret,
        { algorithm: 'HS256', expiresIn: -1 },
      );

      const res = await request(app)
        .get('/interactive/validate')
        .query({ token: expiredToken });

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Token has expired');
    });
  });
});

