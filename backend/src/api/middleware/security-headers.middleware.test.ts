import request from 'supertest';
import express, { Request, Response } from 'express';
import { securityHeadersMiddleware } from './security-headers.middleware';

const app = express();
// Add a middleware beforehand to set X-Powered-By so we can verify it gets removed
app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'Express');
  next();
});
app.use(securityHeadersMiddleware);
app.get('/test', (req: Request, res: Response) => {
  res.send('ok');
});

describe('Security Headers Middleware', () => {
  it('should set security headers on response', async () => {
    const res = await request(app).get('/test');
    
    expect(res.status).toEqual(200);
    expect(res.headers['content-security-policy']).toEqual("default-src 'self'; frame-ancestors 'none'; object-src 'none';");
    expect(res.headers['x-frame-options']).toEqual('DENY');
    expect(res.headers['x-content-type-options']).toEqual('nosniff');
    expect(res.headers['referrer-policy']).toEqual('no-referrer');
    expect(res.headers['x-xss-protection']).toEqual('0');
    expect(res.headers['strict-transport-security']).toEqual('max-age=31536000; includeSubDomains; preload');
    expect(res.headers['x-download-options']).toEqual('noopen');
    expect(res.headers['x-permitted-cross-domain-policies']).toEqual('none');
    expect(res.headers['permissions-policy']).toEqual('accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
