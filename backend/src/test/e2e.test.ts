import request from 'supertest';
import nock from 'nock';
import { Keypair } from '@stellar/stellar-sdk';
import app from '../index';
import prisma from '../lib/prisma';

// Mock auth middleware for testing
jest.mock('../api/middleware/auth.middleware', () => ({
  authMiddleware: (req: any, res: any, next: any) => next(),
  AuthRequest: {},
}));

// Mock rate limiters
jest.mock('../api/middleware/rate-limit.middleware', () => ({
  submissionLimiter: (req: any, res: any, next: any) => next(),
  apiLimiter: (req: any, res: any, next: any) => next(),
  authLimiter: (req: any, res: any, next: any) => next(),
  sensitiveApiLimiter: (req: any, res: any, next: any) => next(),
  publicLimiter: (req: any, res: any, next: any) => next(),
}));

describe('AnchorPoint E2E Tests (SEP-1, SEP-10, SEP-12, SEP-24, SEP-31, SEP-38)', () => {
  const clientKeypair = Keypair.random();
  const clientPublicKey = clientKeypair.publicKey();
  let authToken = '';
  let quoteId = '';
  let sep31TransactionId = '';
  let kycId = '';

  beforeAll(async () => {
    await prisma.transaction.deleteMany();
    await prisma.quote.deleteMany();
    await prisma.user.deleteMany();
    await prisma.kycCustomer.deleteMany();
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

      expect(res.status).toBe(400);
    });

    // For E2E testing, we'll mock the JWT generation
    it('generates a mock JWT for further tests', () => {
      // In production, this would be obtained through proper SEP-10 flow
      // For testing, we'll use a mock token or bypass auth where needed
      authToken = 'mock-jwt-token-for-testing';
    });
  });

  describe('SEP-12: KYC Customer Information', () => {
    it('should submit customer KYC information', async () => {
      // Mock the KYC provider
      nock('https://api.kyc-provider.com')
        .post('/customers')
        .reply(200, {
          id: 'kyc_123',
          status: 'PENDING'
        });

      const res = await request(app)
        .put('/sep12/customer')
        .set('Authorization', `Bearer ${authToken}`)
        .field('account', clientPublicKey)
        .field('first_name', 'John')
        .field('last_name', 'Doe')
        .field('email_address', 'john.doe@example.com')
        .field('bank_account_number', '1234567890')
        .field('bank_routing_number', '021000021');

      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('id', clientPublicKey);
      expect(res.body).toHaveProperty('status', 'PENDING');
      kycId = res.body.id;
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

    it('should handle KYC provider webhook updates', async () => {
      // Mock webhook signature verification
      nock('https://api.kyc-provider.com')
        .get('/verify-signature')
        .reply(200, { valid: true });

      const webhookPayload = {
        account: clientPublicKey,
        status: 'ACCEPTED'
      };

      const res = await request(app)
        .post('/sep12/webhook')
        .set('x-kyc-signature', 'mock-signature')
        .send(webhookPayload);

      expect(res.status).toBe(200);
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
        .set('Authorization', `Bearer ${authToken}`)
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

  describe('SEP-31: Cross-Border Payments', () => {
    it('should retrieve SEP-31 info with supported assets and KYC fields', async () => {
      const res = await request(app).get('/sep31/info');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('receive');
      expect(res.body.receive).toHaveProperty('USDC');
      expect(res.body.receive.USDC).toHaveProperty('enabled', true);
      expect(res.body.receive.USDC).toHaveProperty('sender_info_needed');
      expect(res.body.receive.USDC).toHaveProperty('receiver_info_needed');
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
            email_address: 'john.sender@example.com',
            bank_account_number: '1234567890',
            bank_routing_number: '021000021'
          },
          receiver_info: {
            first_name: 'Jane',
            last_name: 'Receiver',
            email_address: 'jane.receiver@example.com',
            bank_account_number: '0987654321',
            bank_routing_number: '021000021'
          },
          callback: 'https://example.com/callback'
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('stellar_account_id');
      sep31TransactionId = res.body.id;

      // Verify transaction was created in database
      const dbTransaction = await prisma.transaction.findUnique({
        where: { id: sep31TransactionId }
      });
      expect(dbTransaction).not.toBeNull();
      expect(dbTransaction?.type).toBe('SEP31');
      expect(dbTransaction?.assetCode).toBe('USDC');
      expect(dbTransaction?.amount).toBe('100.00');
    });

    it('should retrieve the SEP-31 transaction details', async () => {
      const res = await request(app)
        .get(`/sep31/transactions/${sep31TransactionId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.transaction).toHaveProperty('id', sep31TransactionId);
      expect(res.body.transaction).toHaveProperty('status', 'pending_sender');
      expect(res.body.transaction).toHaveProperty('asset_code', 'USDC');
      expect(res.body.transaction).toHaveProperty('amount_in', '100.00');
    });

    it('should update transaction status through the payment flow', async () => {
      // Mock callback server
      const callbackServer = nock('https://example.com')
        .post('/callback')
        .reply(200);

      // Update to pending_stellar
      let res = await request(app)
        .patch(`/admin/transactions/${sep31TransactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'pending_stellar' });

      expect(res.status).toBe(200);

      // Verify status update
      res = await request(app)
        .get(`/sep31/transactions/${sep31TransactionId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.body.transaction.status).toBe('pending_stellar');

      // Update to pending_receiver
      res = await request(app)
        .patch(`/admin/transactions/${sep31TransactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'pending_receiver' });

      expect(res.status).toBe(200);

      // Update to completed with settlement details
      res = await request(app)
        .patch(`/admin/transactions/${sep31TransactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          status: 'completed',
          stellar_transaction_id: 'stellar_tx_123',
          external_transaction_id: 'external_tx_456',
          amount_out: '99.50',
          amount_fee: '0.50'
        });

      expect(res.status).toBe(200);

      // Verify final transaction state
      res = await request(app)
        .get(`/sep31/transactions/${sep31TransactionId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.body.transaction.status).toBe('completed');
      expect(res.body.transaction.stellar_transaction_id).toBe('stellar_tx_123');
      expect(res.body.transaction.external_transaction_id).toBe('external_tx_456');
      expect(res.body.transaction.amount_out).toBe('99.50');
      expect(res.body.transaction.amount_fee).toBe('0.50');
      expect(res.body.transaction).toHaveProperty('completed_at');

      // Verify callback was sent
      callbackServer.done();
    });
  });

  describe('SEP-24: Interactive', () => {
    it('should initiate an interactive deposit with a valid quote', async () => {
      const res = await request(app)
        .post('/sep24/transactions/deposit/interactive')
        .set('Authorization', `Bearer ${authToken}`)
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
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asset_code: 'USDC',
          account: clientPublicKey,
          quote_id: 'invalid-quote-id',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('Complete Cross-Border Payment Flow Integration', () => {
    let fullFlowTransactionId = '';

    it('should complete full cross-border payment flow from KYC to settlement', async () => {
      // 1. KYC Submission (already done above, but ensuring it's accepted)
      const kycRes = await request(app)
        .get('/sep12/customer')
        .query({ account: clientPublicKey })
        .set('Authorization', `Bearer ${authToken}`);

      expect(kycRes.body.status).toBe('ACCEPTED');

      // 2. Create SEP-31 Transaction
      const txRes = await request(app)
        .post('/sep31/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asset_code: 'USDC',
          amount: '500.00',
          sender_info: {
            first_name: 'Alice',
            last_name: 'Smith',
            email_address: 'alice.smith@example.com',
            bank_account_number: '1111111111',
            bank_routing_number: '021000021',
            address: '123 Main St, New York, NY 10001'
          },
          receiver_info: {
            first_name: 'Bob',
            last_name: 'Johnson',
            email_address: 'bob.johnson@example.com',
            bank_account_number: '2222222222',
            bank_routing_number: '021000021',
            address: '456 Oak Ave, London, UK'
          },
          callback: 'https://merchant.example.com/sep31/callback'
        });

      expect(txRes.status).toBe(201);
      fullFlowTransactionId = txRes.body.id;

      // 3. Simulate the complete payment processing flow
      const callbackServer = nock('https://merchant.example.com')
        .post('/sep31/callback')
        .times(4) // Expect 4 callback notifications
        .reply(200);

      // Status: pending_sender -> pending_stellar
      await request(app)
        .patch(`/admin/transactions/${fullFlowTransactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'pending_stellar' });

      // Status: pending_stellar -> pending_receiver
      await request(app)
        .patch(`/admin/transactions/${fullFlowTransactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'pending_receiver' });

      // Status: pending_receiver -> pending_external
      await request(app)
        .patch(`/admin/transactions/${fullFlowTransactionId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'pending_external' });

      // Final settlement: pending_external -> completed
      const settlementRes = await request(app)
        .patch(`/admin/transactions/${fullFlowTransactionId}`)
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
      expect(finalTxRes.body.transaction.stellar_transaction_id).toBe('stellar_settlement_tx_789');
      expect(finalTxRes.body.transaction.external_transaction_id).toBe('bank_transfer_101112');

      // 5. Verify all callbacks were sent
      callbackServer.done();

      // 6. Verify transaction history includes the completed transaction
      const historyRes = await request(app)
        .get('/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ asset_code: 'USDC' });

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.transactions).toContainEqual(
        expect.objectContaining({
          id: fullFlowTransactionId,
          status: 'completed',
          amount_in: '500.00',
          amount_fee: '5.00'
        })
      );
    });
  });
});
