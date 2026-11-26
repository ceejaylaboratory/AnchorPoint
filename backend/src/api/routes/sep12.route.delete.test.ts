import request from 'supertest';
import express, { Express } from 'express';
import sep12Router from '../api/routes/sep12.route';
import { sep12Controller } from '../api/controllers/sep12.controller';
import { authMiddleware } from '../api/middleware/auth.middleware';

jest.mock('../api/middleware/auth.middleware', () => ({
  authMiddleware: jest.fn((req, res, next) => {
    if (req.headers.authorization) {
      (req as any).user = { publicKey: req.params.account || 'G12345678901234567890123456789012345678901234567890' };
    }
    next();
  }),
}));

jest.mock('../lib/prisma', () => ({
  user: {
    findUnique: jest.fn(),
  },
  kycCustomer: {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
}));

jest.mock('../lib/redis', () => ({
  redis: {
    lPush: jest.fn().mockResolvedValue(1),
  },
}));

describe('SEP-12 DELETE /customer/:account', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/sep12', sep12Router);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 without auth', async () => {
    const res = await request(app).delete('/sep12/customer/G12345678901234567890123456789012345678901234567890');
    expect(res.status).toBe(401);
  });

  it('should return 400 for invalid stellar account', async () => {
    const res = await request(app)
      .delete('/sep12/customer/invalid')
      .set('Authorization', 'Bearer token');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid Stellar account');
  });

  it('should return 404 when customer not found', async () => {
    const prisma = require('../lib/prisma');
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete('/sep12/customer/G12345678901234567890123456789012345678901234567890')
      .set('Authorization', 'Bearer token');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Customer not found');
  });

  it('should return 200 on successful soft-delete', async () => {
    const prisma = require('../lib/prisma');
    prisma.user.findUnique.mockResolvedValue({ id: 'user-123', publicKey: 'G12345678901234567890123456789012345678901234567890' });

    const res = await request(app)
      .delete('/sep12/customer/G12345678901234567890123456789012345678901234567890')
      .set('Authorization', 'Bearer token');
    expect(res.status).toBe(200);
    expect(prisma.kycCustomer.updateMany).toHaveBeenCalled();
  });
});