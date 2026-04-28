import request from 'supertest';

jest.mock('./lib/prisma', () => ({
  transaction: {
    findMany: jest.fn(),
    count: jest.fn()
  }
}));

jest.mock('./api/middleware/rate-limit.middleware', () => ({
  submissionLimiter: (req: any, res: any, next: any) => next(),
  apiLimiter: (req: any, res: any, next: any) => next(),
  authLimiter: (req: any, res: any, next: any) => next(),
  sensitiveApiLimiter: (req: any, res: any, next: any) => next(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require('./index').default;


describe('Backend API', () => {
  it('should return UP on health check', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('UP');
  });

  it('should return 200 on root access', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.text).toContain('AnchorPoint Backend API is running.');
  });
});
