import request from 'supertest';
import express, { Request, Response } from 'express';
import { securityHeadersMiddleware } from './security-headers.middleware';

const app = express();
app.use(securityHeadersMiddleware);
app.get('/test', (req: Request, res: Response) => {
  res.send('ok');
});

describe('Security Headers Middleware', () => {
  it('should set the Permissions-Policy header', async () => {
    const res = await request(app).get('/test');

    expect(res.status).toEqual(200);
    expect(res.headers['permissions-policy']).toEqual('accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
  });
});
