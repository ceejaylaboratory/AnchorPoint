import '@jest/globals';
import request from 'supertest';
import express, { Express } from 'express';

jest.mock('@prisma/client', () => ({
  KYCStatus: {
    PENDING: 'PENDING',
    ACCEPTED: 'ACCEPTED',
    REJECTED: 'REJECTED',
  },
  PrismaClient: jest.fn(),
}));

jest.mock('../api/middleware/auth.middleware', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    req.user = {
      publicKey: req.body?.account || req.query?.account || 'GB7KUA47QKRI6Q6X7C3HOC2HEP6VJQRQWQYQF66VJPHJRVMEDJOVML6K'
    };
    next();
  },
  AuthRequest: {},
}));

const KYCStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
} as const;

type KycStatusValue = (typeof KYCStatus)[keyof typeof KYCStatus];

// ─── In-memory store (simulates Prisma for HTTP-level integration tests) ───

type StoredUser = { id: string; publicKey: string };
type StoredKycCustomer = {
  id: string;
  userId: string;
  provider?: string | null;
  providerRef?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  status: KycStatusValue;
  documents?: Record<string, string>;
};

const usersByPublicKey = new Map<string, StoredUser>();
const usersById = new Map<string, StoredUser>();
const kycByUserId = new Map<string, StoredKycCustomer>();
const kycById = new Map<string, StoredKycCustomer>();
let userCounter = 0;
let kycCounter = 0;

const resetStore = () => {
  usersByPublicKey.clear();
  usersById.clear();
  kycByUserId.clear();
  kycById.clear();
  userCounter = 0;
  kycCounter = 0;
};

const prismaMock = {
  user: {
    findUnique: jest.fn(async ({ where, include }: { where: { publicKey?: string; id?: string }; include?: { kycCustomer?: boolean } }) => {
      const user =
        (where.publicKey ? usersByPublicKey.get(where.publicKey) : undefined) ??
        (where.id ? usersById.get(where.id) : undefined) ??
        null;

      if (!user) return null;

      if (include?.kycCustomer) {
        return { ...user, kycCustomer: kycByUserId.get(user.id) ?? null };
      }

      return user;
    }),
    create: jest.fn(async ({ data }: { data: { publicKey: string } }) => {
      userCounter += 1;
      const user: StoredUser = { id: `user-${userCounter}`, publicKey: data.publicKey };
      usersByPublicKey.set(user.publicKey, user);
      usersById.set(user.id, user);
      return user;
    }),
  },
  kycCustomer: {
    upsert: jest.fn(async ({ where, update, create }: { where: { userId: string }; update: Partial<StoredKycCustomer>; create: Partial<StoredKycCustomer> }) => {
      const existing = kycByUserId.get(where.userId);
      if (existing) {
        const updated: StoredKycCustomer = { ...existing, ...update };
        kycByUserId.set(where.userId, updated);
        kycById.set(updated.id, updated);
        return updated;
      }

      kycCounter += 1;
      const created: StoredKycCustomer = {
        id: `kyc-${kycCounter}`,
        userId: where.userId,
        status: KYCStatus.PENDING,
        ...create,
      };
      kycByUserId.set(where.userId, created);
      kycById.set(created.id, created);
      return created;
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<StoredKycCustomer> }) => {
      const existing = kycById.get(where.id);
      if (!existing) throw new Error('KycCustomer not found');
      const updated: StoredKycCustomer = { ...existing, ...data };
      kycByUserId.set(updated.userId, updated);
      kycById.set(updated.id, updated);
      return updated;
    }),
    findFirst: jest.fn(async ({ where }: { where: { provider?: string; providerRef?: string } }) => {
      for (const kyc of kycByUserId.values()) {
        if (kyc.provider === where.provider && kyc.providerRef === where.providerRef) {
          return kyc;
        }
      }
      return null;
    }),
    delete: jest.fn(async ({ where }: { where: { userId: string } }) => {
      const existing = kycByUserId.get(where.userId);
      if (existing) {
        kycByUserId.delete(where.userId);
        kycById.delete(existing.id);
      }
      return existing ?? null;
    }),
  },
};

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: prismaMock,
}));

import sep12Router from '../api/routes/sep12.route';

// ─── Test app ──────────────────────────────────────────────────────────────
// Mount the SEP-12 router without SEP-10 auth so tests focus on KYC flow.

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/sep12', sep12Router);
  return app;
}

const app = buildApp();

const TEST_ACCOUNT = 'GB7KUA47QKRI6Q6X7C3HOC2HEP6VJQRQWQYQF66VJPHJRVMEDJOVML6K';

const validCustomer = {
  account: TEST_ACCOUNT,
  first_name: 'Jane',
  last_name: 'Doe',
  email_address: 'jane.pending@example.com',
};

// ─── PUT /sep12/customer ───────────────────────────────────────────────────

describe('PUT /sep12/customer', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
    process.env.KYC_PROVIDER = 'mock';
  });

  it('returns 400 when account is missing', async () => {
    const res = await request(app)
      .put('/sep12/customer')
      .send({ first_name: 'Jane' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('account is required');
  });

  it('returns 202 and creates a pending KYC record for a valid submission', async () => {
    const res = await request(app).put('/sep12/customer').send(validCustomer);

    expect(res.status).toBe(202);
    expect(res.body.id).toBe(TEST_ACCOUNT);
    expect(res.body.status).toBe('PROCESSING');

    const user = usersByPublicKey.get(TEST_ACCOUNT);
    expect(user).toBeDefined();

    const kyc = kycByUserId.get(user!.id);
    expect(kyc).toBeDefined();
    expect(kyc!.provider).toBe('mock');
    expect(kyc!.providerRef).toMatch(/^mock_/);
    expect(kyc!.status).toBe(KYCStatus.PENDING);
  });

  it('reuses an existing user on subsequent submissions', async () => {
    await request(app).put('/sep12/customer').send(validCustomer);
    await request(app).put('/sep12/customer').send({
      ...validCustomer,
      first_name: 'Janet',
    });

    expect(usersByPublicKey.size).toBe(1);
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.kycCustomer.upsert).toHaveBeenCalledTimes(2);
  });
});

// ─── GET /sep12/customer ───────────────────────────────────────────────────

describe('GET /sep12/customer', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
    process.env.KYC_PROVIDER = 'mock';
  });

  it('returns 400 when account query param is missing', async () => {
    const res = await request(app).get('/sep12/customer');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('account is required');
  });

  it('returns 404 when no KYC record exists', async () => {
    userCounter += 1;
    const user: StoredUser = { id: 'user-orphan', publicKey: TEST_ACCOUNT };
    usersByPublicKey.set(TEST_ACCOUNT, user);
    usersById.set(user.id, user);

    const res = await request(app).get('/sep12/customer').query({ account: TEST_ACCOUNT });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Customer not found');
  });

  it('returns customer status for an existing KYC record', async () => {
    await request(app).put('/sep12/customer').send(validCustomer);

    const res = await request(app).get('/sep12/customer').query({ account: TEST_ACCOUNT });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TEST_ACCOUNT);
    expect(res.body.status).toBe(KYCStatus.PENDING);
  });

  it('includes provided_fields when status is ACCEPTED', async () => {
    await request(app).put('/sep12/customer').send(validCustomer);
    const user = usersByPublicKey.get(TEST_ACCOUNT)!;
    const kyc = kycByUserId.get(user.id)!;

    kyc.status = KYCStatus.ACCEPTED;
    kyc.firstName = 'iv|encrypted-first';
    kyc.lastName = 'iv|encrypted-last';
    kyc.email = 'iv|encrypted-email';

    const res = await request(app).get('/sep12/customer').query({ account: TEST_ACCOUNT });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(KYCStatus.ACCEPTED);
    expect(res.body.provided_fields).toEqual({
      first_name: { description: 'First Name', status: 'ACCEPTED' },
      last_name: { description: 'Last Name', status: 'ACCEPTED' },
      email_address: { description: 'Email', status: 'ACCEPTED' },
    });
  });
});

// ─── POST /sep12/webhook ───────────────────────────────────────────────────

describe('POST /sep12/webhook', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
    process.env.KYC_PROVIDER = 'mock';
  });

  it('returns 401 for an invalid webhook signature', async () => {
    const res = await request(app)
      .post('/sep12/webhook')
      .set('x-kyc-signature', 'bad-signature')
      .send({ providerRef: 'mock_abc', status: 'accepted' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('returns 404 when the customer cannot be resolved', async () => {
    const res = await request(app)
      .post('/sep12/webhook')
      .set('x-kyc-signature', 'mock-valid-signature')
      .send({ providerRef: 'mock_unknown', status: 'accepted' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Customer not found');
  });

  it('updates KYC status via providerRef lookup', async () => {
    const putRes = await request(app).put('/sep12/customer').send(validCustomer);
    expect(putRes.status).toBe(202);

    const user = usersByPublicKey.get(TEST_ACCOUNT)!;
    const kyc = kycByUserId.get(user.id)!;

    const res = await request(app)
      .post('/sep12/webhook')
      .set('x-kyc-signature', 'mock-valid-signature')
      .send({ providerRef: kyc.providerRef, status: 'accepted' });

    expect(res.status).toBe(200);
    expect(kycByUserId.get(user.id)!.status).toBe(KYCStatus.ACCEPTED);
  });

  it('updates KYC status via account fallback when providerRef is absent', async () => {
    await request(app).put('/sep12/customer').send(validCustomer);
    const user = usersByPublicKey.get(TEST_ACCOUNT)!;

    const res = await request(app)
      .post('/sep12/webhook')
      .set('x-kyc-signature', 'mock-valid-signature')
      .send({ account: TEST_ACCOUNT, status: 'rejected' });

    expect(res.status).toBe(200);
    expect(kycByUserId.get(user.id)!.status).toBe(KYCStatus.REJECTED);
  });
});

// ─── DELETE /sep12/customer/:account ───────────────────────────────────────

describe('DELETE /sep12/customer/:account', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
    process.env.KYC_PROVIDER = 'mock';
  });

  it('returns 200 and removes the KYC record', async () => {
    await request(app).put('/sep12/customer').send(validCustomer);
    const user = usersByPublicKey.get(TEST_ACCOUNT)!;
    expect(kycByUserId.has(user.id)).toBe(true);

    const res = await request(app).delete(`/sep12/customer/${TEST_ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(kycByUserId.has(user.id)).toBe(false);
  });

  it('returns 200 even when the account has no KYC record', async () => {
    const res = await request(app).delete(`/sep12/customer/${TEST_ACCOUNT}`);
    expect(res.status).toBe(200);
  });
});

// ─── End-to-end KYC lifecycle ────────────────────────────────────────────────

describe('SEP-12 KYC lifecycle', () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
    process.env.KYC_PROVIDER = 'mock';
  });

  it('submits, accepts via webhook, and returns accepted status on GET', async () => {
    const submit = await request(app).put('/sep12/customer').send(validCustomer);
    expect(submit.status).toBe(202);

    const user = usersByPublicKey.get(TEST_ACCOUNT)!;
    const kyc = kycByUserId.get(user.id)!;

    const webhook = await request(app)
      .post('/sep12/webhook')
      .set('x-kyc-signature', 'mock-valid-signature')
      .send({ providerRef: kyc.providerRef, status: 'accepted' });
    expect(webhook.status).toBe(200);

    kyc.firstName = 'iv|encrypted-first';
    kyc.lastName = 'iv|encrypted-last';
    kyc.email = 'iv|encrypted-email';

    const status = await request(app).get('/sep12/customer').query({ account: TEST_ACCOUNT });
    expect(status.status).toBe(200);
    expect(status.body.status).toBe(KYCStatus.ACCEPTED);
    expect(status.body.provided_fields).toBeDefined();

    const deleted = await request(app).delete(`/sep12/customer/${TEST_ACCOUNT}`);
    expect(deleted.status).toBe(200);

    const afterDelete = await request(app).get('/sep12/customer').query({ account: TEST_ACCOUNT });
    expect(afterDelete.status).toBe(404);
  });
});
