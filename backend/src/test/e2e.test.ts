import request from 'supertest';
import nock from 'nock';
import { Keypair } from '@stellar/stellar-sdk';
import app from '../index';

// Mock problematic services and middleware
jest.mock('../api/middleware/auth.middleware', () => ({
  authMiddleware: (req: any, res: any, next: any) => next(),
  AuthRequest: {},
}));

jest.mock('../api/middleware/rate-limit.middleware', () => ({
  submissionLimiter: (req: any, res: any, next: any) => next(),
  apiLimiter: (req: any, res: any, next: any) => next(),
  authLimiter: (req: any, res: any, next: any) => next(),
  sensitiveApiLimiter: (req: any, res: any, next: any) => next(),
  publicLimiter: (req: any, res: any, next: any) => next(),
}));

// Mock services that have missing dependencies
jest.mock('../services/redis.service', () => ({
  RedisService: class {
    setJSON() { return Promise.resolve(); }
    get() { return Promise.resolve(null); }
  }
}));

describe('AnchorPoint E2E Tests - Cross-Border Payment Flow', () => {
  const clientKeypair = Keypair.random();
  const clientPublicKey = clientKeypair.publicKey();
  let authToken = '';
  let quoteId = '';
  let sep31TransactionId = '';

  beforeAll(() => {
    // Clean up any existing mocks
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('SEP-1: Info Endpoint', () => {
    it('should return anchor information', async () => {
      const res = await request(app).get('/info');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('network');
      expect(res.body).toHaveProperty('assets');
    });
  });

  describe('SEP-10: Authentication (Mocked)', () => {
    it('should accept mock authentication for testing', () => {
      // For E2E testing, we'll use a mock token
      authToken = 'mock-jwt-token-for-e2e-testing';
      expect(authToken).toBeDefined();
    });
  });

  describe('SEP-12: KYC Customer Information', () => {
    it('should submit customer KYC information', async () => {
      // Mock KYC provider response
      nock('https://api.kyc-provider.com')
        .post('/customers')
        .reply(200, { id: 'kyc_123', status: 'ACCEPTED' });

      const res = await request(app)
        .put('/sep12/customer')
        .set('Authorization', `Bearer ${authToken}`)
        .field('account', clientPublicKey)
        .field('first_name', 'John')
        .field('last_name', 'Doe')
        .field('email_address', 'john.doe@example.com');

      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('id', clientPublicKey);
      expect(res.body).toHaveProperty('status', 'ACCEPTED');
    });

    it('should retrieve customer KYC status', async () => {
      const res = await request(app)
        .get('/sep12/customer')
        .query({ account: clientPublicKey })
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', clientPublicKey);
      expect(res.body).toHaveProperty('status');
    });
  });

  describe('SEP-38: Price Quotes', () => {
    it('should get a price quote for asset exchange', async () => {
      // Mock external price API
      nock('https://api.coingecko.com')
        .get(/api\/v3\/simple\/price/)
        .reply(200, { 'usd-coin': { usd: 1.0 }, 'stellar': { usd: 0.12 } });

      const res = await request(app)
        .post('/sep38/quote')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          source_asset: 'USDC',
          source_amount: '100',
          destination_asset: 'XLM'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('price');
      expect(res.body.price).toBeGreaterThan(0);
      quoteId = res.body.id;
    });
  });

  describe('SEP-31: Cross-Border Payments', () => {
    it('should retrieve SEP-31 asset information', async () => {
      const res = await request(app).get('/sep31/info');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('receive');
      expect(res.body.receive).toHaveProperty('USDC');
    });

    it('should create a SEP-31 cross-border payment transaction', async () => {
      const res = await request(app)
        .post('/sep31/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asset_code: 'USDC',
          amount: '100.00',
          sender_info: {
            first_name: 'John',
            last_name: 'Sender',
            email_address: 'john.sender@example.com'
          },
          receiver_info: {
            first_name: 'Jane',
            last_name: 'Receiver',
            email_address: 'jane.receiver@example.com'
          },
          callback: 'https://example.com/callback'
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('stellar_account_id');
      sep31TransactionId = res.body.id;
    });

    it('should retrieve transaction details', async () => {
      const res = await request(app)
        .get(`/sep31/transactions/${sep31TransactionId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.transaction).toHaveProperty('id', sep31TransactionId);
      expect(res.body.transaction).toHaveProperty('status');
      expect(res.body.transaction).toHaveProperty('asset_code', 'USDC');
    });

    it('should update transaction status through payment flow', async () => {
      // Mock callback server
      const callbackServer = nock('https://example.com')
        .post('/callback')
        .reply(200);

      // Update status to pending_stellar
      let res = await request(app)
        .patch(`/api/admin/transactions/${sep31TransactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'pending_stellar' });

      expect(res.status).toBe(200);

      // Update to pending_receiver
      res = await request(app)
        .patch(`/api/admin/transactions/${sep31TransactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'pending_receiver' });

      expect(res.status).toBe(200);

      // Final settlement
      res = await request(app)
        .patch(`/api/admin/transactions/${sep31TransactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          status: 'completed',
          stellar_transaction_id: 'stellar_tx_123',
          external_transaction_id: 'bank_tx_456',
          amount_out: '99.50',
          amount_fee: '0.50'
        });

      expect(res.status).toBe(200);

      // Verify final state
      res = await request(app)
        .get(`/sep31/transactions/${sep31TransactionId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.body.transaction.status).toBe('completed');
      expect(res.body.transaction.stellar_transaction_id).toBe('stellar_tx_123');
      expect(res.body.transaction.external_transaction_id).toBe('bank_tx_456');

      callbackServer.done();
    });
  });

  describe('SEP-24: Interactive Deposits/Withdrawals', () => {
    it('should initiate an interactive deposit', async () => {
      const res = await request(app)
        .post('/sep24/transactions/deposit/interactive')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asset_code: 'USDC',
          account: clientPublicKey,
          amount: '50.00'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('type', 'interactive_customer_info_needed');
      expect(res.body).toHaveProperty('url');
    });
  });

  describe('Complete Cross-Border Payment Flow Integration', () => {
    let fullFlowTransactionId = '';

    it('should complete full payment flow: KYC → Quote → SEP-31 → Settlement', async () => {
      // 1. KYC is already done above

      // 2. Create SEP-31 transaction
      const txRes = await request(app)
        .post('/sep31/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asset_code: 'USDC',
          amount: '500.00',
          sender_info: {
            first_name: 'Alice',
            last_name: 'Smith',
            email_address: 'alice.smith@example.com'
          },
          receiver_info: {
            first_name: 'Bob',
            last_name: 'Johnson',
            email_address: 'bob.johnson@example.com'
          },
          callback: 'https://merchant.example.com/callback'
        });

      expect(txRes.status).toBe(201);
      fullFlowTransactionId = txRes.body.id;

      // 3. Simulate complete payment processing
      const callbackServer = nock('https://merchant.example.com')
        .post('/callback')
        .times(3) // Expect status updates
        .reply(200);

      // Process through all statuses
      await request(app)
        .patch(`/api/admin/transactions/${fullFlowTransactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'pending_stellar' });

      await request(app)
        .patch(`/api/admin/transactions/${fullFlowTransactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'pending_receiver' });

      await request(app)
        .patch(`/api/admin/transactions/${fullFlowTransactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'pending_external' });

      // Final settlement
      const settlementRes = await request(app)
        .patch(`/api/admin/transactions/${fullFlowTransactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          status: 'completed',
          stellar_transaction_id: 'stellar_settlement_tx_789',
          external_transaction_id: 'bank_transfer_101112',
          amount_out: '495.00',
          amount_fee: '5.00'
        });

      expect(settlementRes.status).toBe(200);

      // 4. Verify final transaction state
      const finalTxRes = await request(app)
        .get(`/sep31/transactions/${fullFlowTransactionId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(finalTxRes.body.transaction.status).toBe('completed');
      expect(finalTxRes.body.transaction.amount_in).toBe('500.00');
      expect(finalTxRes.body.transaction.amount_out).toBe('495.00');
      expect(finalTxRes.body.transaction.amount_fee).toBe('5.00');

      callbackServer.done();
    });
  });
});