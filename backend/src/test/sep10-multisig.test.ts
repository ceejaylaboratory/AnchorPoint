import request from 'supertest';
import express, { Request, Response } from 'express';
import { getChallenge, getToken } from '../api/controllers/auth.controller';
import { RedisService, RedisClient } from '../services/redis.service';

const store = new Map<string, string>();

jest.mock('../services/auth.service', () => ({
  generateChallenge: jest.fn().mockReturnValue('challenge-value'),
  generateMultiKeyChallenge: jest.fn((signers, threshold) => ({
    requiredSigners: 1,
    threshold,
    signers,
  })),
  storeChallenge: jest.fn(async (_redis, publicKey, challenge) => {
    store.set(`sep10:challenge:${publicKey}`, JSON.stringify({
      challenge,
      publicKey,
      createdAt: Date.now(),
    }));
  }),
  getChallenge: jest.fn(async (_redis, publicKey) => {
    const raw = store.get(`sep10:challenge:${publicKey}`);
    return raw ? JSON.parse(raw) : null;
  }),
  removeChallenge: jest.fn(async (_redis, publicKey) => {
    store.delete(`sep10:challenge:${publicKey}`);
  }),
  signToken: jest.fn().mockReturnValue('jwt-token'),
  verifyToken: jest.fn(),
  validateMultiKeySignatures: jest.fn((signatures, threshold) => {
    const totalWeight = signatures.reduce((sum: number, sig: any) => sum + sig.weight, 0);
    return {
      valid: totalWeight >= (threshold === 'high' ? 3 : threshold === 'medium' ? 2 : 1),
      authLevel: totalWeight >= 3 ? 'full' : totalWeight >= 2 ? 'medium' : 'partial',
      signers: signatures.map((sig: any) => sig.publicKey),
    };
  }),
  generateSep10ChallengeTransaction: jest.fn((anchorPk, account) => ({
    transactionXdr: `tx:${anchorPk}:${account}`,
    networkPassphrase: 'Test SDF Network ; September 2015',
  })),
  storeSep10Challenge: jest.fn().mockResolvedValue(undefined),
  verifySep10ChallengeTransaction: jest.fn().mockReturnValue({ isValid: true }),
}));

jest.mock('../utils/sep10-stellar', () => ({
  extractAccountFromSep10Transaction: jest.fn().mockReturnValue('GSIGNER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'),
}));

jest.mock('../api/middleware/rate-limit.middleware', () => ({
  publicLimiter: (_req: any, _res: any, next: any) => next(),
  authLimiter: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../utils/tracing', () => ({
  traceAsync: (_name: string, fn: (span: any) => any) => fn({ setAttribute: jest.fn() }),
  traceSync: (_name: string, fn: (span: any) => any) => fn({ setAttribute: jest.fn() }),
  SpanKind: { INTERNAL: 0, CLIENT: 1 },
}));

jest.mock('../services/metrics.service', () => ({
  metricsService: { observeDbQuery: jest.fn() },
}));

const inMemoryRedisClient: RedisClient = {
  get: async (key: string) => store.get(key) ?? null,
  set: async (key: string, value: string) => { store.set(key, value); return 'OK'; },
  del: async (key: string) => { store.delete(key); return 1; },
  expire: async () => 1,
};

const redisService = new RedisService(inMemoryRedisClient);

const app = express();
app.use(express.json());
app.post('/auth', (req: Request, res: Response) => getChallenge(req, res, redisService));
app.post('/auth/token', (req: Request, res: Response) => getToken(req, res, redisService));

beforeEach(() => store.clear());

describe('SEP-10 Multi-Signature Integration Tests', () => {
  const ANCHOR_PUBLIC_KEY = 'GBAD_PUBLIC_KEY';
  const CLIENT_PUBLIC_KEY = 'GCLIENT1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

  const SIGNERS = [
    { publicKey: 'GSIGNER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', weight: 2, signed: false },
    { publicKey: 'GSIGNER2XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', weight: 1, signed: false },
  ];

  describe('POST /auth — multi-key challenge generation', () => {
    it('returns a challenge transaction and network passphrase', async () => {
      const res = await request(app)
        .post('/auth')
        .send({ account: CLIENT_PUBLIC_KEY });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('transaction');
      expect(res.body).toHaveProperty('network_passphrase');
      expect(typeof res.body.transaction).toBe('string');
      expect(res.body.transaction.length).toBeGreaterThan(0);
    });

    it('returns 400 when account is missing', async () => {
      const res = await request(app).post('/auth').send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns multiKeyChallenge when multiKey flag and signers are provided', async () => {
      const res = await request(app)
        .post('/auth')
        .send({ account: CLIENT_PUBLIC_KEY, multiKey: true, signers: SIGNERS, threshold: 'medium' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('multiKeyChallenge');
      const mkc = res.body.multiKeyChallenge;
      expect(mkc.threshold).toBe('medium');
      expect(mkc.signers).toHaveLength(2);
      expect(mkc.requiredSigners).toBeGreaterThan(0);
    });

    it('does not return multiKeyChallenge when multiKey is false', async () => {
      const res = await request(app)
        .post('/auth')
        .send({ account: CLIENT_PUBLIC_KEY, multiKey: false });

      expect(res.status).toBe(200);
      expect(res.body.multiKeyChallenge).toBeUndefined();
    });

    it('stores the challenge in redis for subsequent token validation', async () => {
      await request(app).post('/auth').send({ account: CLIENT_PUBLIC_KEY });
      const key = `sep10:challenge:${CLIENT_PUBLIC_KEY}`;
      expect(store.has(key)).toBe(true);
    });
  });

  describe('POST /auth/token — multi-signature token validation', () => {
    const SIGNER_A = 'GSIGNER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const SIGNER_B = 'GSIGNER2XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

    async function seedChallenge(publicKey: string, challengeValue: string) {
      const key = `sep10:challenge:${publicKey}`;
      store.set(key, JSON.stringify({
        challenge: challengeValue,
        publicKey,
        createdAt: Date.now(),
      }));
    }

    it('returns a JWT for multi-sig request meeting the medium threshold', async () => {
      const challenge = 'test-challenge-abc123';
      await seedChallenge(SIGNER_A, challenge);

      const res = await request(app)
        .post('/auth/token')
        .send({
          transaction: challenge,
          threshold: 'medium',
          signatures: [
            { publicKey: SIGNER_A, signature: 'sig-a', weight: 2 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.type).toBe('bearer');
      expect(res.body.authLevel).toBe('medium');
      expect(res.body.signers).toContain(SIGNER_A);
    });

    it('returns a JWT with partial auth level when weight meets low but not high threshold', async () => {
      const challenge = 'test-challenge-low';
      await seedChallenge(SIGNER_A, challenge);

      const res = await request(app)
        .post('/auth/token')
        .send({
          transaction: challenge,
          threshold: 'low',
          signatures: [
            { publicKey: SIGNER_A, signature: 'sig-a', weight: 1 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.authLevel).toBe('partial');
    });

    it('returns a JWT listing all signers when multiple keys sign', async () => {
      const challenge = 'test-challenge-multisig';
      await seedChallenge(SIGNER_A, challenge);

      const res = await request(app)
        .post('/auth/token')
        .send({
          transaction: challenge,
          threshold: 'medium',
          signatures: [
            { publicKey: SIGNER_A, signature: 'sig-a', weight: 1 },
            { publicKey: SIGNER_B, signature: 'sig-b', weight: 1 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.signers).toContain(SIGNER_A);
      expect(res.body.signers).toContain(SIGNER_B);
    });

    it('returns 400 when cumulative signature weight is below threshold', async () => {
      const challenge = 'test-challenge-low-weight';
      await seedChallenge(SIGNER_A, challenge);

      const res = await request(app)
        .post('/auth/token')
        .send({
          transaction: challenge,
          threshold: 'high',
          signatures: [
            { publicKey: SIGNER_A, signature: 'sig-a', weight: 1 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 when the challenge does not match the stored value', async () => {
      await seedChallenge(SIGNER_A, 'stored-challenge');

      const res = await request(app)
        .post('/auth/token')
        .send({
          transaction: 'wrong-challenge',
          threshold: 'medium',
          signatures: [
            { publicKey: SIGNER_A, signature: 'sig-a', weight: 2 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 when no stored challenge exists for the signer', async () => {
      const res = await request(app)
        .post('/auth/token')
        .send({
          transaction: 'any-challenge',
          threshold: 'medium',
          signatures: [
            { publicKey: 'GUNKNOWN', signature: 'sig', weight: 2 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('removes the challenge from redis after successful token issue (replay prevention)', async () => {
      const challenge = 'test-challenge-replay';
      await seedChallenge(SIGNER_A, challenge);

      await request(app)
        .post('/auth/token')
        .send({
          transaction: challenge,
          threshold: 'medium',
          signatures: [{ publicKey: SIGNER_A, signature: 'sig-a', weight: 2 }],
        });

      const key = `sep10:challenge:${SIGNER_A}`;
      expect(store.has(key)).toBe(false);
    });

    it('returns 400 when transaction field is missing', async () => {
      const res = await request(app)
        .post('/auth/token')
        .send({ signatures: [{ publicKey: SIGNER_A, signature: 'sig', weight: 2 }] });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });
});
