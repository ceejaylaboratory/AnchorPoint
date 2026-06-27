import request from 'supertest';
import prisma from './lib/prisma';
import { redis } from './lib/redis';

jest.mock('./lib/prisma', () => ({
  __esModule: true,
  default: {
    transaction: {
      findMany: jest.fn(),
      count: jest.fn()
    },
    $queryRaw: jest.fn()
  }
}));

jest.mock('./api/middleware/rate-limit.middleware', () => ({
  submissionLimiter: (req: any, res: any, next: any) => next(),
  apiLimiter: (req: any, res: any, next: any) => next(),
  authLimiter: (req: any, res: any, next: any) => next(),
  sensitiveApiLimiter: (req: any, res: any, next: any) => next(),
  publicLimiter: (req: any, res: any, next: any) => next(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require('./index').default;


describe('Backend API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);
    if (typeof redis.ping === 'function') {
      jest.spyOn(redis, 'ping').mockResolvedValue('PONG');
    }
  });

  it('should return UP on health check when all services are healthy', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('UP');
    expect(res.body.services.database).toEqual('UP');
    expect(res.body.services.redis).toEqual('UP');
  });

  it('should return DOWN on health check when database is down', async () => {
    (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error('DB Connection Refused'));

    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(503);
    expect(res.body.status).toEqual('DOWN');
    expect(res.body.services.database).toEqual('DOWN');
    expect(res.body.services.redis).toEqual('UP');
  });

  it('should return DOWN on health check when Redis is down', async () => {
    jest.spyOn(redis, 'ping').mockRejectedValue(new Error('Redis Timeout'));

    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(503);
    expect(res.body.status).toEqual('DOWN');
    expect(res.body.services.database).toEqual('UP');
    expect(res.body.services.redis).toEqual('DOWN');
  });

  it('should return 200 on root access', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.text).toContain('AnchorPoint Backend API is running.');
  });
});
