import express from 'express';
import request from 'supertest';
import http from 'http';

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
    transaction: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// In-memory Redis Pub/Sub so SSE subscribers receive what the router publishes.
jest.mock('../../lib/redis', () => {
  const { EventEmitter } = require('events');
  const bus = new EventEmitter();
  const makeClient = (): any => {
    const client = new EventEmitter();
    const channels = new Set<string>();
    const relay = (channel: string, message: string) => {
      if (channels.has(channel)) client.emit('message', channel, message);
    };
    bus.on('publish', relay);
    return Object.assign(client, {
      duplicate: () => makeClient(),
      subscribe: (channel: string, cb?: (err: Error | null) => void) => {
        channels.add(channel);
        cb?.(null);
      },
      unsubscribe: (channel: string) => channels.delete(channel),
      quit: () => bus.off('publish', relay),
      publish: jest.fn(async (channel: string, message: string) => {
        bus.emit('publish', channel, message);
        return 1;
      }),
      get: async () => null,
      set: async () => 'OK',
      del: async () => 1,
    });
  };
  return { __esModule: true, redis: makeClient(), redlock: {} };
});

jest.mock('../../services/sep24.service', () => {
  const actual = jest.requireActual('../../services/sep24.service');
  return {
    ...actual,
    Sep24Service: {
      ...actual.Sep24Service,
      storeCallback: jest.fn().mockResolvedValue(undefined),
      getCallback: jest.fn(),
      notifyStatusChange: jest.fn(),
      validateCallbackUrl: actual.Sep24Service.validateCallbackUrl,
    },
  };
});

import sep24Router from './sep24.route';
import { Sep24Service } from '../../services/sep24.service';

jest.setTimeout(15000);

describe('SEP-24 Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/', sep24Router);

  const baseUrl = 'http://localhost:4100';
  const validAccount = 'GCM5WPR4DDR24FSAX5LIEM4J7AI3KOWJYANSXEPKYXCSZOTAYXE75AFN';

  beforeEach(() => {
    process.env.INTERACTIVE_URL = baseUrl;
    jest.clearAllMocks();
    (Sep24Service.storeCallback as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.INTERACTIVE_URL;
    delete process.env.SEP24_ALLOWED_CALLBACK_DOMAINS;
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

    it('returns 400 when redirect_url is not in whitelist', async () => {
      process.env.SEP24_ALLOWED_CALLBACK_DOMAINS = 'example.com';
      const res = await request(app)
        .post('/transactions/deposit/interactive')
        .send({ asset_code: 'USDC', redirect_url: 'https://malicious.com/callback' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('invalid redirect_url domain');
    });

    it('returns 400 when on_change_callback is not in whitelist', async () => {
      process.env.SEP24_ALLOWED_CALLBACK_DOMAINS = 'example.com';
      const res = await request(app)
        .post('/transactions/deposit/interactive')
        .send({ asset_code: 'USDC', on_change_callback: 'https://malicious.com/hook' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('invalid on_change_callback domain');
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

    it('returns 400 when redirect_url is not in whitelist', async () => {
      process.env.SEP24_ALLOWED_CALLBACK_DOMAINS = 'example.com';
      const res = await request(app)
        .post('/transactions/withdraw/interactive')
        .send({ asset_code: 'USDC', redirect_url: 'https://malicious.com/callback' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('invalid redirect_url domain');
    });

    it('returns 400 when on_change_callback is not in whitelist', async () => {
      process.env.SEP24_ALLOWED_CALLBACK_DOMAINS = 'example.com';
      const res = await request(app)
        .post('/transactions/withdraw/interactive')
        .send({ asset_code: 'USDC', on_change_callback: 'https://malicious.com/hook' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('invalid on_change_callback domain');
    });
  });

  describe('GET /transaction', () => {
    it('returns 400 when no query parameters are supplied', async () => {
      const res = await request(app).get('/transaction');
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('One of id, stellar_transaction_id, or external_transaction_id is required');
    });

    it('returns 404 when transaction is not found', async () => {
      const prisma = require('../../lib/prisma').default;
      prisma.transaction.findFirst.mockResolvedValueOnce(null);

      const res = await request(app).get('/transaction?id=nonexistent-id');
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Transaction not found');
    });

    it('returns 400 when stellar transaction hash is missing', async () => {
      const prisma = require('../../lib/prisma').default;
      prisma.transaction.findFirst.mockResolvedValueOnce({
        id: 'tx-123',
        type: 'DEPOSIT',
        status: 'PENDING',
        amount: '10.00',
        assetCode: 'USDC',
        stellarTxId: null,
        externalId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app).get('/transaction?id=tx-123');
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Stellar transaction hash is missing or invalid');
    });

    it('returns 200 with transaction details when stellar transaction hash is present', async () => {
      const prisma = require('../../lib/prisma').default;
      const createdAt = new Date();
      prisma.transaction.findFirst.mockResolvedValueOnce({
        id: 'tx-123',
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount: '50.00',
        assetCode: 'USDC',
        stellarTxId: 'hash-123456789',
        externalId: 'ext-999',
        createdAt,
        updatedAt: createdAt,
      });

      const res = await request(app).get('/transaction?id=tx-123');
      expect(res.statusCode).toBe(200);
      expect(res.body.transaction).toBeDefined();
      expect(res.body.transaction.id).toBe('tx-123');
      expect(res.body.transaction.stellar_transaction_id).toBe('hash-123456789');
    });
  });

  describe('GET /fee', () => {
    it('returns 400 when asset_code is missing', async () => {
      const res = await request(app).get('/fee?operation=deposit&amount=100');
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('asset_code');
    });

    it('returns 400 when operation is invalid', async () => {
      const res = await request(app).get('/fee?asset_code=USDC&operation=swap&amount=100');
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('operation');
    });

    it('returns 400 when amount is missing', async () => {
      const res = await request(app).get('/fee?asset_code=USDC&operation=deposit');
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('amount');
    });

    it('returns 400 for unknown asset', async () => {
      const res = await request(app).get('/fee?asset_code=DOGE&operation=deposit&amount=100');
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('Unknown asset');
    });

    it('returns itemized fee breakdown for USDC deposit under 1000 (1% tier)', async () => {
      const res = await request(app).get('/fee?asset_code=USDC&operation=deposit&amount=500');
      expect(res.statusCode).toBe(200);
      expect(res.body.asset_code).toBe('USDC');
      expect(res.body.operation).toBe('deposit');
      expect(res.body.amount).toBe(500);
      // fixed 0.5 + 500*0.01=5 = 5.5
      expect(res.body.fee_percent).toBe(0.01);
      expect(res.body.fee).toBeCloseTo(5.5, 5);
      expect(Array.isArray(res.body.fee_details)).toBe(true);
    });

    it('returns reduced 0.5% tier for amounts >= 1000', async () => {
      const res = await request(app).get('/fee?asset_code=USDC&operation=deposit&amount=2000');
      expect(res.statusCode).toBe(200);
      expect(res.body.fee_percent).toBe(0.005);
    });

    it('works for withdrawal operation', async () => {
      const res = await request(app).get('/fee?asset_code=USD&operation=withdrawal&amount=100');
      expect(res.statusCode).toBe(200);
      expect(res.body.operation).toBe('withdrawal');
    });
  });

  describe('GET /transaction/sse', () => {
    it('returns 400 when id is missing', async () => {
      const res = await request(app).get('/transaction/sse');
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('id');
    });

    it('streams status updates published for the transaction and closes on a terminal status', async () => {
      const server = http.createServer(app).listen(0);
      const { port } = server.address() as { port: number };

      try {
        const events = await new Promise<string>((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${port}/transaction/sse?id=tx-sse-1`, (res) => {
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toContain('text/event-stream');

            let body = '';
            res.setEncoding('utf8');
            res.on('data', async (chunk: string) => {
              body += chunk;
              if (chunk.includes('event: connected')) {
                const { redis } = require('../../lib/redis');
                // Updates for other transactions must not leak into this stream.
                await redis.publish('sep24:tx:other', JSON.stringify({ id: 'other', status: 'completed' }));
                await redis.publish('sep24:tx:tx-sse-1', JSON.stringify({ id: 'tx-sse-1', status: 'pending_anchor' }));
                await redis.publish('sep24:tx:tx-sse-1', JSON.stringify({ id: 'tx-sse-1', status: 'completed' }));
              }
            });
            res.on('end', () => resolve(body));
          });
          req.on('error', reject);
        });

        expect(events).toContain('event: connected');
        expect(events).toContain('"status":"pending_anchor"');
        expect(events).toContain('event: done');
        expect(events).not.toContain('"id":"other"');
      } finally {
        server.close();
      }
    });
  });

  describe('PATCH /transactions/:id/status', () => {
    it('returns 400 when status is missing', async () => {
      const res = await request(app)
        .patch('/transactions/tx-1/status')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('status is required');
    });

    it('returns 404 when no partner callback is configured', async () => {
      (Sep24Service.getCallback as jest.Mock).mockResolvedValueOnce(null);

      const res = await request(app)
        .patch('/transactions/tx-1/status')
        .send({ status: 'completed' });

      expect(res.statusCode).toBe(404);
      expect(res.body.error).toContain('No partner callback');
    });

    it('notifies partner webhook with idempotent delivery result', async () => {
      (Sep24Service.getCallback as jest.Mock).mockResolvedValueOnce({
        callbackUrl: 'https://partner.example/hook',
        kind: 'deposit',
        assetCode: 'USDC',
        amount: '10',
      });
      (Sep24Service.notifyStatusChange as jest.Mock).mockResolvedValueOnce({
        delivered: true,
        attempts: 1,
        statusCode: 200,
        idempotencyKey: 'sep24:tx-1:pending_user->completed',
      });
      const prisma = require('../../lib/prisma').default;
      prisma.transaction.update.mockResolvedValueOnce({
        id: 'tx-1',
        amount: '10',
        assetCode: 'USDC',
        stellarTxId: null,
        externalId: null,
      });

      const res = await request(app)
        .patch('/transactions/tx-1/status')
        .send({ status: 'completed', previous_status: 'pending_user' });

      expect(res.statusCode).toBe(200);
      expect(res.body.webhook.delivered).toBe(true);
      expect(res.body.webhook.idempotencyKey).toBe(
        'sep24:tx-1:pending_user->completed'
      );
      expect(Sep24Service.notifyStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: 'tx-1',
          kind: 'deposit',
          previousStatus: 'pending_user',
          nextStatus: 'completed',
          callbackUrl: 'https://partner.example/hook',
        })
      );
    });

    it('publishes the status change to the SSE channel and persists claimable balance id', async () => {
      (Sep24Service.getCallback as jest.Mock).mockResolvedValueOnce({
        callbackUrl: 'https://partner.example/hook',
        kind: 'deposit',
      });
      (Sep24Service.notifyStatusChange as jest.Mock).mockResolvedValueOnce({ delivered: true });
      const prisma = require('../../lib/prisma').default;
      prisma.transaction.update.mockResolvedValueOnce({ id: 'tx-2' });
      const { redis } = require('../../lib/redis');

      const res = await request(app)
        .patch('/transactions/tx-2/status')
        .send({ status: 'pending_external', claimable_balance_id: 'cb-123' });

      expect(res.statusCode).toBe(200);
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-2' },
        data: { status: 'PENDING_EXTERNAL', claimableBalanceId: 'cb-123' },
      });
      expect(redis.publish).toHaveBeenCalledWith('sep24:tx:tx-2', expect.any(String));
      const payload = JSON.parse((redis.publish as jest.Mock).mock.calls.at(-1)[1]);
      expect(payload).toEqual(
        expect.objectContaining({ id: 'tx-2', status: 'pending_external', claimable_balance_id: 'cb-123' }),
      );
    });

    it('stores partner callback on interactive deposit', async () => {
      const res = await request(app)
        .post('/transactions/deposit/interactive')
        .send({
          asset_code: 'USDC',
          on_change_callback: 'https://partner.example/hook',
        });

      expect(res.statusCode).toBe(200);
      expect(Sep24Service.storeCallback).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000000',
        expect.objectContaining({
          callbackUrl: 'https://partner.example/hook',
          kind: 'deposit',
          assetCode: 'USDC',
        })
      );
    });
  });
});

