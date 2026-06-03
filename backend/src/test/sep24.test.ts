import express, { Express } from 'express';
import request from 'supertest';

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomUUID: jest.fn(() => 'test-uuid-1234-5678-9abc-def012345678'),
  };
});

jest.mock('../lib/prisma', () => ({
  quote: {
    findUnique: jest.fn(),
  },
}));

import sep24Router from '../api/routes/sep24.route';
import prisma from '../lib/prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/sep24', sep24Router);
  return app;
}

const app = buildApp();
const BASE = '/sep24/transactions';
const BASE_URL = 'http://localhost:4200';

beforeEach(() => {
  process.env.INTERACTIVE_URL = BASE_URL;
  jest.clearAllMocks();
});

afterEach(() => {
  delete process.env.INTERACTIVE_URL;
});

// ─── Deposit ──────────────────────────────────────────────────────────────────

describe('POST /sep24/transactions/deposit/interactive', () => {
  it('returns 400 when asset_code is missing', async () => {
    const res = await request(app).post(`${BASE}/deposit/interactive`).send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('asset_code is required');
  });

  it('returns 400 for an unsupported asset', async () => {
    const res = await request(app)
      .post(`${BASE}/deposit/interactive`)
      .send({ asset_code: 'DOGE' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('DOGE is not supported');
    expect(res.body.error).toContain('Supported assets:');
  });

  it('returns 200 with interactive_customer_info_needed for a supported asset', async () => {
    const res = await request(app)
      .post(`${BASE}/deposit/interactive`)
      .send({ asset_code: 'USDC', account: 'GACCOUNT123', amount: '50.00' });

    expect(res.statusCode).toBe(200);
    expect(res.body.type).toBe('interactive_customer_info_needed');
    expect(res.body.id).toBe('test-uuid-1234-5678-9abc-def012345678');

    const parsed = new URL(res.body.url);
    expect(parsed.pathname).toBe('/kyc-deposit');
    expect(parsed.searchParams.get('transaction_id')).toBe(res.body.id);
    expect(parsed.searchParams.get('asset_code')).toBe('USDC');
    expect(parsed.searchParams.get('account')).toBe('GACCOUNT123');
    expect(parsed.searchParams.get('amount')).toBe('50.00');
  });

  it('normalises asset_code to uppercase', async () => {
    const res = await request(app)
      .post(`${BASE}/deposit/interactive`)
      .send({ asset_code: 'usdc' });

    expect(res.statusCode).toBe(200);
    const parsed = new URL(res.body.url);
    expect(parsed.searchParams.get('asset_code')).toBe('USDC');
  });

  it('defaults lang to en when omitted', async () => {
    const res = await request(app)
      .post(`${BASE}/deposit/interactive`)
      .send({ asset_code: 'USDC' });

    const parsed = new URL(res.body.url);
    expect(parsed.searchParams.get('lang')).toBe('en');
  });

  it('passes lang parameter into the redirect URL', async () => {
    const res = await request(app)
      .post(`${BASE}/deposit/interactive`)
      .send({ asset_code: 'USD', lang: 'es' });

    const parsed = new URL(res.body.url);
    expect(parsed.searchParams.get('lang')).toBe('es');
  });

  it('returns 400 when quote_id is not found', async () => {
    (mockPrisma.quote.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const res = await request(app)
      .post(`${BASE}/deposit/interactive`)
      .send({ asset_code: 'USDC', quote_id: 'nonexistent-quote' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Quote not found');
  });

  it('returns 400 when quote is expired', async () => {
    (mockPrisma.quote.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'expired-quote',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await request(app)
      .post(`${BASE}/deposit/interactive`)
      .send({ asset_code: 'USDC', quote_id: 'expired-quote' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Quote has expired');
  });

  it('returns 200 with a valid non-expired quote', async () => {
    (mockPrisma.quote.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'valid-quote',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await request(app)
      .post(`${BASE}/deposit/interactive`)
      .send({ asset_code: 'USDC', quote_id: 'valid-quote' });

    expect(res.statusCode).toBe(200);
    expect(res.body.type).toBe('interactive_customer_info_needed');
  });

  it('omits optional params from URL when not provided', async () => {
    const res = await request(app)
      .post(`${BASE}/deposit/interactive`)
      .send({ asset_code: 'USD' });

    const parsed = new URL(res.body.url);
    expect(parsed.searchParams.has('account')).toBe(false);
    expect(parsed.searchParams.has('amount')).toBe(false);
  });
});

// ─── Withdraw ─────────────────────────────────────────────────────────────────

describe('POST /sep24/transactions/withdraw/interactive', () => {
  it('returns 400 when asset_code is missing', async () => {
    const res = await request(app).post(`${BASE}/withdraw/interactive`).send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('asset_code is required');
  });

  it('returns 400 for an unsupported asset', async () => {
    const res = await request(app)
      .post(`${BASE}/withdraw/interactive`)
      .send({ asset_code: 'SHIB' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('SHIB is not supported');
  });

  it('returns 200 with interactive_customer_info_needed for a supported asset', async () => {
    const res = await request(app)
      .post(`${BASE}/withdraw/interactive`)
      .send({ asset_code: 'USD', account: 'GWALLET', amount: '200' });

    expect(res.statusCode).toBe(200);
    expect(res.body.type).toBe('interactive_customer_info_needed');
    expect(res.body.id).toBe('test-uuid-1234-5678-9abc-def012345678');

    const parsed = new URL(res.body.url);
    expect(parsed.pathname).toBe('/kyc-withdraw');
    expect(parsed.searchParams.get('asset_code')).toBe('USD');
    expect(parsed.searchParams.get('account')).toBe('GWALLET');
    expect(parsed.searchParams.get('amount')).toBe('200');
  });

  it('normalises asset_code to uppercase', async () => {
    const res = await request(app)
      .post(`${BASE}/withdraw/interactive`)
      .send({ asset_code: 'usdc' });

    expect(res.statusCode).toBe(200);
    const parsed = new URL(res.body.url);
    expect(parsed.searchParams.get('asset_code')).toBe('USDC');
  });

  it('defaults lang to en when omitted', async () => {
    const res = await request(app)
      .post(`${BASE}/withdraw/interactive`)
      .send({ asset_code: 'USDC' });

    const parsed = new URL(res.body.url);
    expect(parsed.searchParams.get('lang')).toBe('en');
  });

  it('passes lang parameter into the redirect URL', async () => {
    const res = await request(app)
      .post(`${BASE}/withdraw/interactive`)
      .send({ asset_code: 'USDC', lang: 'fr' });

    const parsed = new URL(res.body.url);
    expect(parsed.searchParams.get('lang')).toBe('fr');
  });

  it('returns 400 when quote_id is not found', async () => {
    (mockPrisma.quote.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const res = await request(app)
      .post(`${BASE}/withdraw/interactive`)
      .send({ asset_code: 'USDC', quote_id: 'ghost-quote' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Quote not found');
  });

  it('returns 400 when quote is expired', async () => {
    (mockPrisma.quote.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'stale-quote',
      expiresAt: new Date(Date.now() - 5_000),
    });

    const res = await request(app)
      .post(`${BASE}/withdraw/interactive`)
      .send({ asset_code: 'USDC', quote_id: 'stale-quote' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Quote has expired');
  });

  it('returns 200 with a valid non-expired quote', async () => {
    (mockPrisma.quote.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'fresh-quote',
      expiresAt: new Date(Date.now() + 120_000),
    });

    const res = await request(app)
      .post(`${BASE}/withdraw/interactive`)
      .send({ asset_code: 'USD', quote_id: 'fresh-quote' });

    expect(res.statusCode).toBe(200);
    expect(res.body.type).toBe('interactive_customer_info_needed');
  });

  it('omits optional params from URL when not provided', async () => {
    const res = await request(app)
      .post(`${BASE}/withdraw/interactive`)
      .send({ asset_code: 'USDC' });

    const parsed = new URL(res.body.url);
    expect(parsed.searchParams.has('account')).toBe(false);
    expect(parsed.searchParams.has('amount')).toBe(false);
  });

  it('includes all optional query params in the redirect URL', async () => {
    const res = await request(app)
      .post(`${BASE}/withdraw/interactive`)
      .send({
        asset_code: 'USDC',
        account: 'GTEST',
        amount: '75.50',
        lang: 'de',
      });

    const parsed = new URL(res.body.url);
    expect(parsed.searchParams.get('account')).toBe('GTEST');
    expect(parsed.searchParams.get('amount')).toBe('75.50');
    expect(parsed.searchParams.get('lang')).toBe('de');
  });
});
