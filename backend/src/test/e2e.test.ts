import express from 'express';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import sep24Router from '../api/routes/sep24.route';

const app = express();
app.use(express.json());
app.use('/sep24', sep24Router);

describe('AnchorPoint E2E Tests - SEP-24 Withdrawal', () => {
  const clientKeypair = Keypair.random();
  const clientPublicKey = clientKeypair.publicKey();

  it('creates an interactive deposit session', async () => {
    const res = await request(app)
      .post('/sep24/transactions/deposit/interactive')
      .send({
        asset_code: 'USDC',
        account: clientPublicKey,
        amount: '100',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('type', 'interactive_customer_info_needed');
    expect(res.body).toHaveProperty('id');

    const parsed = new URL(res.body.url);
    expect(parsed.pathname).toBe('/kyc-deposit');
    expect(parsed.searchParams.get('transaction_id')).toBe(res.body.id);
    expect(parsed.searchParams.get('asset_code')).toBe('USDC');
    expect(parsed.searchParams.get('account')).toBe(clientPublicKey);
    expect(parsed.searchParams.get('amount')).toBe('100');
  });

  it('creates an interactive withdrawal session', async () => {
    const res = await request(app)
      .post('/sep24/transactions/withdraw/interactive')
      .send({
        asset_code: 'USDC',
        account: clientPublicKey,
        amount: '25',
        lang: 'en',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('type', 'interactive_customer_info_needed');
    expect(res.body).toHaveProperty('id');

    const parsed = new URL(res.body.url);
    expect(parsed.pathname).toBe('/kyc-withdraw');
    expect(parsed.searchParams.get('transaction_id')).toBe(res.body.id);
    expect(parsed.searchParams.get('asset_code')).toBe('USDC');
    expect(parsed.searchParams.get('account')).toBe(clientPublicKey);
    expect(parsed.searchParams.get('amount')).toBe('25');
    expect(parsed.searchParams.get('lang')).toBe('en');
  });
});
