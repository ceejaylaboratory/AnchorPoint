import request from 'supertest';
import express from 'express';
import transactionsRouter from './transactions.route';
import prisma from '../../lib/prisma';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'stellar-anchor-secret';

jest.mock('../../lib/prisma', () => ({
  transaction: {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn().mockResolvedValue({ id: 'user_123', publicKey: 'GBXP...' }),
  },
  $queryRaw: jest.fn(),
  $queryRawUnsafe: jest.fn(),
}));

jest.mock('../../lib/socket', () => ({
  emitTxUpdated: jest.fn(),
  emitTransactionStatusUpdate: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../utils/tracing', () => {
  const dummySpan = {
    setAttribute: jest.fn(),
    setAttributes: jest.fn(),
    recordException: jest.fn(),
    setStatus: jest.fn(),
    end: jest.fn(),
  };
  return {
    traceAsync: (_name: any, fn: any) => fn(dummySpan),
    traceSync: (_name: any, fn: any) => fn(dummySpan),
    SpanKind: {},
    initTracing: jest.fn(),
    createTraceExporter: jest.fn(),
  };
});

jest.mock('../../lib/redis', () => {
  const client = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    on: jest.fn(),
    subscribe: jest.fn(),
    duplicate: jest.fn().mockReturnValue({
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      on: jest.fn(),
      subscribe: jest.fn(),
    }),
  };
  return {
    __esModule: true,
    default: client,
    redisClient: client,
    redis: client,
  };
});

// Mock Rate Limiting
jest.mock('../middleware/rate-limit.middleware', () => ({
  submissionLimiter: (req: any, res: any, next: any) => next(),
}));



const app = express();
app.use(express.json());
app.use('/api/transactions', transactionsRouter);

describe('Transactions Router', () => {
  const mockPublicKey = 'GBXP...';
  let token: string;

  beforeAll(() => {
    token = jwt.sign({ sub: mockPublicKey }, JWT_SECRET);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return transactions with pagination', async () => {
    const mockData = [{ id: '1', amount: '100', user: { publicKey: mockPublicKey } }];
    (prisma.transaction.findMany as jest.Mock).mockResolvedValue(mockData);
    (prisma.transaction.count as jest.Mock).mockResolvedValue(1);

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .query({ page: '1', limit: '10' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('success');
    expect(res.body.data.transactions).toEqual(mockData);
    expect(res.body.data.pagination.total).toEqual(1);
  });

  it('should filter transactions by assetCode', async () => {
    (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.transaction.count as jest.Mock).mockResolvedValue(0);

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .query({ assetCode: 'USDC' });

    expect(res.statusCode).toEqual(200);
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        assetCode: 'USDC',
        userId: expect.any(String),
      }),
    }));
  });

  it('should return 401 if no token provided', async () => {
    const res = await request(app).get('/api/transactions');
    expect(res.statusCode).toEqual(401);
  });

  it('should return 401 for invalid token', async () => {
    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.statusCode).toEqual(401);
  });

  it('should return 400 for invalid query parameters', async () => {
    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .query({ page: 'abc' });
    expect(res.statusCode).toEqual(400);
  });

  it('should search transactions by indexed sender value', async () => {
    const eventRows = [{ txHash: 'tx123' }];
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue(eventRows);
    (prisma.transaction.findMany as jest.Mock).mockResolvedValue([{ id: '1', stellarTxId: 'tx123', amount: '100' }]);
    (prisma.transaction.count as jest.Mock).mockResolvedValue(1);

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .query({ sender: 'GABC', page: '1', limit: '10' });

    expect(res.statusCode).toEqual(200);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalled();
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        stellarTxId: { in: ['tx123'] },
      }),
    }));
    expect(res.body.data.transactions).toEqual([{ id: '1', stellarTxId: 'tx123', amount: '100' }]);
  });

  it('should return 500 on database error', async () => {
    (prisma.transaction.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toEqual(500);
    expect(res.body.message).toEqual('Failed to fetch transaction history');
  });

  describe('PATCH /api/transactions/:id/status', () => {
    it('should update transaction status and emit socket event', async () => {
      const mockTx = {
        id: 'tx_123',
        userId: 'user_123',
        status: 'COMPLETED',
        updatedAt: new Date(),
        stellarTxId: 'stellar_hash_1',
        assetCode: 'USDC',
        amount: '50',
        type: 'DEPOSIT',
      };

      (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(mockTx);
      (prisma.transaction.update as jest.Mock).mockResolvedValue(mockTx);

      const res = await request(app)
        .patch('/api/transactions/tx_123/status')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'COMPLETED' });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(prisma.transaction.update).toHaveBeenCalledWith({
        where: { id: 'tx_123' },
        data: { status: 'COMPLETED' },
      });
      const { emitTransactionStatusUpdate } = require('../../lib/socket');
      expect(emitTransactionStatusUpdate).toHaveBeenCalledWith(
        expect.arrayContaining(['user_123', mockPublicKey]),
        expect.objectContaining({
          id: 'tx_123',
          status: 'COMPLETED',
          stellar_transaction_id: 'stellar_hash_1',
          updated_at: mockTx.updatedAt,
        })
      );
    });

    it('should return 404 if transaction not found', async () => {
      (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);

      const res = await request(app)
        .patch('/api/transactions/non_existent/status')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'COMPLETED' });

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toBe('Transaction not found');
    });

    it('should return 400 for invalid status', async () => {
      const res = await request(app)
        .patch('/api/transactions/tx_123/status')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'INVALID_STATUS' });

      expect(res.statusCode).toBe(400);
    });
  });
});

