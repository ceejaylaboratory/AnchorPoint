/// <reference types="jest" />

import request from 'supertest';
import nock from 'nock';
import prisma from '../lib/prisma';
import app from '../index';


// Make auth + rate limit pass through for this E2E suite.
jest.mock('../api/middleware/auth.middleware', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    req.user = {
      publicKey: req.body?.account || req.query?.account || 'GB7KUA47QKRI6Q6X7C3HOC2HEP6VJQRQWQYQF66VJPHJRVMEDJOVML6K'
    };
    next();
  },
  AuthRequest: {},
}));

jest.mock('../api/middleware/rate-limit.middleware', () => ({
  submissionLimiter: (req: any, res: any, next: any) => next(),
  apiLimiter: (req: any, res: any, next: any) => next(),
  authLimiter: (req: any, res: any, next: any) => next(),
  sensitiveApiLimiter: (req: any, res: any, next: any) => next(),
  publicLimiter: (req: any, res: any, next: any) => next(),
}));

const hasPostgresDatasource = /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL || '');
const e2eSuite = hasPostgresDatasource ? describe : describe.skip;

e2eSuite('AnchorPoint E2E - Cross-border payment flow (KYC → SEP-38 quote → SEP-31 settlement)', () => {
  const clientPublicKey = 'GB7KUA47QKRI6Q6X7C3HOC2HEP6VJQRQWQYQF66VJPHJRVMEDJOVML6K';
  const receiverPublicKey = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

  const authToken = 'mock-jwt-token-for-e2e-testing';
  let quoteId = '';
  let transactionId = '';
  let callbackCount = 0;

  beforeAll(async () => {
    // Keep the DB deterministic per run.
    await prisma.transaction.deleteMany({ where: { type: 'SEP31' } });
    await prisma.quote.deleteMany();
    await prisma.kycCustomer.deleteMany();
    await prisma.user.deleteMany();

    jest.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url.toString().includes('merchant.example.com')) {
        callbackCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true }),
        } as any);
      }
      return Promise.reject(new Error(`Unmocked fetch to ${url}`));
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('SEP-12 KYC: submits sender and receiver customer profiles', async () => {
    nock('https://api.kyc-provider.com')
      .post('/customers')
      .reply(200, { id: 'kyc_sender_123', status: 'ACCEPTED' });

    const senderRes = await request(app)
      .put('/sep12/customer')
      .set('Authorization', `Bearer ${authToken}`)
      .field('account', clientPublicKey)
      .field('first_name', 'Alice')
      .field('last_name', 'Smith')
      .field('email_address', 'alice.smith@example.com')
      .field('bank_account_number', '1111111111')
      .field('bank_routing_number', '021000021')
      .field('address', '123 Main St, New York, NY 10001');

    expect(senderRes.status).toBe(202);
    expect(senderRes.body).toHaveProperty('id', clientPublicKey);
    expect(senderRes.body).toHaveProperty('status', 'ACCEPTED');

    nock('https://api.kyc-provider.com')
      .post('/customers')
      .reply(200, { id: 'kyc_receiver_456', status: 'ACCEPTED' });

    const receiverRes = await request(app)
      .put('/sep12/customer')
      .set('Authorization', `Bearer ${authToken}`)
      .field('account', receiverPublicKey)
      .field('first_name', 'Bob')
      .field('last_name', 'Johnson')
      .field('email_address', 'bob.johnson@example.com')
      .field('bank_account_number', '2222222222')
      .field('bank_routing_number', '021000021')
      .field('address', '456 Oak Ave, London, UK');

    expect(receiverRes.status).toBe(202);
    expect(receiverRes.body).toHaveProperty('id', receiverPublicKey);
    expect(receiverRes.body).toHaveProperty('status', 'ACCEPTED');
  });

  it('SEP-38 quote: creates an indicative quote and persists it', async () => {
    // sep38 uses CoinGecko live prices.
    // The implementation maps:
    //  - XLM  -> stellar
    //  - USDC -> usd-coin
    nock('https://api.coingecko.com')
      .get(/\/api\/v3\/simple\/price\?ids=.*&vs_currencies=usd/)
      .reply(200, {
        'usd-coin': { usd: 1.0 },
        stellar: { usd: 0.12 },
      });

    const res = await request(app)
      .post('/sep38/quote')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        source_asset: 'USDC',
        source_amount: '100',
        destination_asset: 'XLM',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('price');
    expect(Number(res.body.price)).toBeGreaterThan(0);

    quoteId = res.body.id;
  });

  it('SEP-31: creates transaction and completes settlement (status progression + callback)', async () => {
    callbackCount = 0;

    const txRes = await request(app)
      .post('/sep31/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        asset_code: 'USDC',
        amount: '500.00',
        sender_info: {
          first_name: 'Alice',
          last_name: 'Sender',
          email_address: 'alice.sender@example.com',
        },
        receiver_info: {
          first_name: 'Bob',
          last_name: 'Receiver',
          email_address: 'bob.receiver@example.com',
        },
        callback: 'https://merchant.example.com/sep31/callback',
        // Some anchors include SEP-38 quote_id; even if not required by this backend
        // the field is harmless.
        quote_id: quoteId || undefined,
      });

    if (txRes.status !== 201) {
      console.log('TX RES ERROR BODY:', txRes.body);
    }
    expect(txRes.status).toBe(201);
    expect(txRes.body).toHaveProperty('id');
    expect(txRes.body).toHaveProperty('stellar_account_id');
    transactionId = txRes.body.id;

    // Verify initial state.
    const details1 = await request(app)
      .get(`/sep31/transactions/${transactionId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(details1.status).toBe(200);
    expect(details1.body.transaction.id).toBe(transactionId);
    expect(details1.body.transaction.status).toBe('pending_sender');
    expect(details1.body.transaction.asset_code).toBe('USDC');
    expect(details1.body.transaction.amount_in).toBe('500.00');

    // Drive status transitions via admin API.
    let res = await request(app)
      .patch(`/api/admin/transactions/${transactionId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'pending_stellar' });
    expect(res.status).toBe(200);

    res = await request(app)
      .patch(`/api/admin/transactions/${transactionId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'pending_receiver' });
    expect(res.status).toBe(200);

    res = await request(app)
      .patch(`/api/admin/transactions/${transactionId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'pending_external' });
    expect(res.status).toBe(200);

    res = await request(app)
      .patch(`/api/admin/transactions/${transactionId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        status: 'completed',
        stellar_transaction_id: 'stellar_settlement_tx_789',
        external_transaction_id: 'bank_transfer_101112',
        amount_out: '495.00',
        amount_fee: '5.00',
      });
    expect(res.status).toBe(200);

    const final = await request(app)
      .get(`/sep31/transactions/${transactionId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(final.status).toBe(200);
    expect(final.body.transaction.status).toBe('completed');
    expect(final.body.transaction.stellar_transaction_id).toBe('stellar_settlement_tx_789');
    expect(final.body.transaction.external_transaction_id).toBe('bank_transfer_101112');
    expect(final.body.transaction.amount_out).toBe('495.00');
    expect(final.body.transaction.amount_fee).toBe('5.00');
    expect(final.body.transaction.completed_at).toBeTruthy();

    expect(callbackCount).toBe(4);
  });

  it('Transaction history: includes completed transaction', async () => {
    const res = await request(app)
      .get('/api/transactions')
      .query({ assetCode: 'USDC', limit: 10 })
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toContainEqual(
      expect.objectContaining({
        id: transactionId,
        assetCode: 'USDC',
        amount: '500.00',
        status: 'completed',
      }),
    );
  });
});
