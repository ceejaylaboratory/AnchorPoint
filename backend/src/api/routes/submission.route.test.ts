import request from 'supertest';
import express from 'express';
import transactionsRouter from './transactions.route';
import { stellarService } from '../../services/stellar.service';
import jwt from 'jsonwebtoken';
import * as StellarSdk from '@stellar/stellar-sdk';

const JWT_SECRET = process.env.JWT_SECRET || 'stellar-anchor-secret';

// Mock StellarService
jest.mock('../../services/stellar.service', () => ({
  stellarService: {
    submitTransaction: jest.fn(),
  },
}));

// Mock Rate Limiting
jest.mock('../middleware/rate-limit.middleware', () => ({
  submissionLimiter: (req: any, res: any, next: any) => next(),
}));


// Mock Prisma
jest.mock('../../lib/prisma', () => ({
  transaction: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/api/transactions', transactionsRouter);

describe('Transactions Router - /submit', () => {
  const mockPublicKey = 'GBXP...';
  let token: string;

  beforeAll(() => {
    token = jwt.sign({ sub: mockPublicKey }, JWT_SECRET);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully submit a valid transaction XDR', async () => {
    const mockXdr = 'AAAAAgAAAAD...'; // Dummy XDR
    (stellarService.submitTransaction as jest.Mock).mockResolvedValue({
      hash: 'mock-hash',
      ledger: 12345,
    });

    const res = await request(app)
      .post('/api/transactions/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ xdr: mockXdr });

    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('success');
    expect(res.body.data.hash).toEqual('mock-hash');
    expect(stellarService.submitTransaction).toHaveBeenCalledWith(mockXdr);
  });

  it('should return 400 when submission fails', async () => {
    const mockXdr = 'AAAAAgAAAAD...';
    (stellarService.submitTransaction as jest.Mock).mockRejectedValue(new Error('Operation type not whitelisted'));

    const res = await request(app)
      .post('/api/transactions/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ xdr: mockXdr });

    expect(res.statusCode).toEqual(400);
    expect(res.body.status).toEqual('error');
    expect(res.body.message).toEqual('Operation type not whitelisted');
  });

  it('should return 400 when XDR is missing', async () => {
    const res = await request(app)
      .post('/api/transactions/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.statusCode).toEqual(400);
  });
});
