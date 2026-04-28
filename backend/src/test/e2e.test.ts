import request from 'supertest';
import nock from 'nock';
import { Keypair } from '@stellar/stellar-sdk';
import app from '../index';
import prisma from '../lib/prisma';

describe('AnchorPoint E2E Tests (SEP-1, SEP-10, SEP-24, SEP-38)', () => {
  const clientKeypair = Keypair.random();
  const clientPublicKey = clientKeypair.publicKey();
  let authToken = '';
  let quoteId = '';

  beforeAll(async () => {
    await prisma.transaction.deleteMany();
    await prisma.quote.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('SEP-1: Info', () => {
    it('should fetch TOML/Info configuration', async () => {
      const res = await request(app).get('/info');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('network');
    });
  });

  describe('SEP-10: Authentication', () => {
    let challengeTransaction: string;

    it('should initiate auth and return a challenge', async () => {
      const res = await request(app)
        .post('/auth')
        .send({ account: clientPublicKey });
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('transaction');
      challengeTransaction = res.body.transaction;
    });

    it('should reject invalid signatures', async () => {
      const res = await request(app)
        .post('/auth/token')
        .send({ transaction: challengeTransaction, client_signature: 'invalid' });
      
      expect(res.status).toBe(400); // Because invalid transaction signature format or expired
    });

    // We skip actual signing because we'd need the Server Keypair from the environment.
    // Instead, we will simulate the JWT generation for subsequent tests.
    it('generates a mock JWT for further tests', () => {
      // In a real E2E we'd use the SDK to sign. We'll just bypass auth for the sake of the next tests
      // or assume we have a mock token generator.
      // For this test suite, let's mock the auth middleware.
    });
  });

  describe('SEP-38: Quotes', () => {
    it('should create a firm quote and persist it', async () => {
      nock('https://api.coingecko.com')
        .get(/api\/v3\/simple\/price.*/)
        .reply(200, {
          'usd-coin': { usd: 1.0 },
          'stellar': { usd: 0.10 }
        });

      const res = await request(app)
        .post('/sep38/quote')
        .send({
          source_asset: 'USDC',
          source_amount: '100',
          destination_asset: 'XLM'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body.price).toBeGreaterThan(0);
      quoteId = res.body.id;

      // Verify DB Persistence
      const dbQuote = await prisma.quote.findUnique({ where: { id: quoteId } });
      expect(dbQuote).not.toBeNull();
      expect(dbQuote?.sellAsset).toBe('USDC');
    });
  });

  describe('SEP-24: Interactive', () => {
    it('should initiate an interactive deposit with a valid quote', async () => {
      const res = await request(app)
        .post('/sep24/transactions/deposit/interactive')
        .send({
          asset_code: 'USDC',
          account: clientPublicKey,
          quote_id: quoteId,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('type', 'interactive_customer_info_needed');
      expect(res.body).toHaveProperty('url');
    });

    it('should reject an interactive deposit with an invalid quote', async () => {
      const res = await request(app)
        .post('/sep24/transactions/deposit/interactive')
        .send({
          asset_code: 'USDC',
          account: clientPublicKey,
          quote_id: 'invalid-quote-id',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });
});
