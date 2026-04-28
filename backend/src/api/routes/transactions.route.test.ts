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
  },
}));

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
        user: { publicKey: mockPublicKey },
      })
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

  it('should return 500 on database error', async () => {
    (prisma.transaction.findMany as jest.Mock).mockRejectedValue(new Error('DB Error'));

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toEqual(500);
    expect(res.body.message).toEqual('Failed to fetch transaction history');
  });
});
