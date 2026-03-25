import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authMiddleware } from './auth.middleware';

describe('Auth Middleware', () => {
  const app = express();
  app.get('/test', authMiddleware, (req, res) => {
    res.json({ publicKey: (req as any).user?.publicKey });
  });

  const JWT_SECRET = process.env.JWT_SECRET || 'stellar-anchor-secret';
  const mockPublicKey = 'GBMOCKPUBLICKEY...';

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/test');
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe('Authentication required. No token provided.');
  });

  it('returns 401 when Authorization header is not a Bearer token', async () => {
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Basic abc');
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe('Authentication required. No token provided.');
  });

  it('returns 200 and exposes the publicKey when token is valid', async () => {
    const token = jwt.sign({ sub: mockPublicKey }, JWT_SECRET);

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.publicKey).toBe(mockPublicKey);
  });

  it('returns 401 when token verification fails', async () => {
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe('Invalid or expired token.');
  });
});

