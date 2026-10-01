import request from 'supertest';
import express from 'express';
import usersRoute from './users.route';

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com' }),
    },
    userPasswordResetToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'token-1' }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        tokenHash: 'hashed',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60000),
      }),
      update: jest.fn().mockResolvedValue({ id: 'token-1' }),
    },
    $transaction: jest.fn(async (callback) =>
      callback({
        userPasswordResetToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn().mockResolvedValue({ id: 'token-1' }),
          update: jest.fn().mockResolvedValue({ id: 'token-1' }),
        },
      }),
    ),
  },
}));

const app = express();
app.use(express.json());
app.use('/api/users', usersRoute);

describe('User password reset routes', () => {
  it('requests password reset and adheres to rate limits', async () => {
    // Test for rate limit
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post('/api/users/password-reset/request')
        .send({ email: 'test@example.com' });
      
      if (i < 3) {
        expect(res.status).toBe(200);
      } else {
        expect(res.status).toBe(429);
      }
    }
  });

  it('confirms password reset with valid payload', async () => {
    const res = await request(app)
      .post('/api/users/password-reset/confirm')
      .send({ token: 'test-token', newPassword: 'validLongPassword123!' });
    expect(res.status).toBe(200);
  });
});

