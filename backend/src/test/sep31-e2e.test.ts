import request from 'supertest';
import nock from 'nock';
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

describe('SEP-31 Cross-Border Payment E2E Flow', () => {
  const clientPublicKey = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJURIXI5JLHY2QB';
  let transactionId = '';

  beforeAll(async () => {
    // Clean up any existing test data
    await prisma.transaction.deleteMany({ where: { type: 'SEP31' } });
    await prisma.kycCustomer.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('KYC Preparation', () => {
    it('should submit KYC information for the sender', async () => {
      // Mock the KYC provider
      nock('https://api.kyc-provider.com')
        .post('/customers')
        .reply(200, {
          id: 'kyc_sender_123',
          status: 'ACCEPTED'
        });

      const res = await request(app)
        .put('/sep12/customer')
        .field('account', clientPublicKey)
        .field('first_name', 'Alice')
        .field('last_name', 'Smith')
        .field('email_address', 'alice.smith@example.com')
        .field('bank_account_number', '1111111111')
        .field('bank_routing_number', '021000021')
        .field('address', '123 Main St, New York, NY 10001');

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('ACCEPTED');
    });

    it('should submit KYC information for the receiver', async () => {
      const receiverKey = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

      nock('https://api.kyc-provider.com')
        .post('/customers')
        .reply(200, {
          id: 'kyc_receiver_456',
          status: 'ACCEPTED'
        });

      const res = await request(app)
        .put('/sep12/customer')
        .field('account', receiverKey)
        .field('first_name', 'Bob')
        .field('last_name', 'Johnson')
        .field('email_address', 'bob.johnson@example.com')
        .field('bank_account_number', '2222222222')
        .field('bank_routing_number', '021000021')
        .field('address', '456 Oak Ave, London, UK');

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('ACCEPTED');
    });
  });

  describe('SEP-31 Transaction Lifecycle', () => {
    it('should retrieve SEP-31 asset information', async () => {
      const res = await request(app).get('/sep31/info');

      expect(res.status).toBe(200);
      expect(res.body.receive).toBeDefined();
      expect(res.body.receive.USDC).toBeDefined();
      expect(res.body.receive.USDC.enabled).toBe(true);
      expect(res.body.receive.USDC.sender_info_needed).toBeDefined();
      expect(res.body.receive.USDC.receiver_info_needed).toBeDefined();
    });

    it('should create a cross-border payment transaction', async () => {
      const res = await request(app)
        .post('/sep31/transactions')
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

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('stellar_account_id');
      transactionId = res.body.id;
    });

    it('should retrieve the transaction details', async () => {
      const res = await request(app)
        .get(`/sep31/transactions/${transactionId}`);

      expect(res.status).toBe(200);
      expect(res.body.transaction.id).toBe(transactionId);
      expect(res.body.transaction.status).toBe('pending_sender');
      expect(res.body.transaction.asset_code).toBe('USDC');
      expect(res.body.transaction.amount_in).toBe('500.00');
    });

    it('should update transaction status through the payment flow', async () => {
      // Mock callback notifications
      const callbackMock = nock('https://merchant.example.com')
        .post('/sep31/callback')
        .times(4)
        .reply(200);

      // 1. pending_sender -> pending_stellar
      let res = await request(app)
        .patch(`/api/admin/transactions/${transactionId}`)
        .send({ status: 'pending_stellar' });

      expect(res.status).toBe(200);

      // 2. pending_stellar -> pending_receiver
      res = await request(app)
        .patch(`/api/admin/transactions/${transactionId}`)
        .send({ status: 'pending_receiver' });

      expect(res.status).toBe(200);

      // 3. pending_receiver -> pending_external
      res = await request(app)
        .patch(`/api/admin/transactions/${transactionId}`)
        .send({ status: 'pending_external' });

      expect(res.status).toBe(200);

      // 4. Final settlement: pending_external -> completed
      res = await request(app)
        .patch(`/api/admin/transactions/${transactionId}`)
        .send({
          status: 'completed',
          stellar_transaction_id: 'stellar_settlement_tx_789',
          external_transaction_id: 'bank_transfer_101112',
          amount_out: '495.00',
          amount_fee: '5.00'
        });

      expect(res.status).toBe(200);

      // Verify all callbacks were sent
      callbackMock.done();
    });

    it('should show completed transaction with settlement details', async () => {
      const res = await request(app)
        .get(`/sep31/transactions/${transactionId}`);

      expect(res.status).toBe(200);
      expect(res.body.transaction.status).toBe('completed');
      expect(res.body.transaction.amount_in).toBe('500.00');
      expect(res.body.transaction.amount_out).toBe('495.00');
      expect(res.body.transaction.amount_fee).toBe('5.00');
      expect(res.body.transaction.stellar_transaction_id).toBe('stellar_settlement_tx_789');
      expect(res.body.transaction.external_transaction_id).toBe('bank_transfer_101112');
      expect(res.body.transaction).toHaveProperty('completed_at');
    });
  });

  describe('Transaction History and Reporting', () => {
    it('should include the completed SEP-31 transaction in history', async () => {
      const res = await request(app)
        .get('/api/transactions')
        .query({ assetCode: 'USDC', limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.data.transactions).toContainEqual(
        expect.objectContaining({
          id: transactionId,
          assetCode: 'USDC',
          amount: '500.00',
          status: 'completed'
        })
      );
    });

    it('should handle transaction status validation', async () => {
      const invalidStatusRes = await request(app)
        .patch(`/api/admin/transactions/${transactionId}`)
        .send({ status: 'invalid_status' });

      expect(invalidStatusRes.status).toBe(500); // Should fail with invalid status
    });
  });
});