import request from 'supertest';
import express from 'express';
import authRouter from './auth.route';
import { authLimiter } from '../middleware/rate-limit.middleware';

const app = express();
app.use(express.json());
app.use('/sep10', authLimiter, authRouter);

describe('Auth Route Rate Limiting', () => {
  it('should return 429 when rate limit is exceeded', async () => {
    // authLimiter max is 10, let's send 11 requests
    for (let i = 0; i < 10; i++) {
      await request(app).post('/sep10').send({ account: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' });
    }
    const response = await request(app).post('/sep10').send({ account: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' });
    expect(response.status).toBe(429);
  });
});
