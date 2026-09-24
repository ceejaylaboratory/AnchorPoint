import request from 'supertest';
import prisma from './lib/prisma';
import { redis } from './lib/redis';

if (!process.env.PRODUCTION_CORS_ORIGINS) {
  process.env.PRODUCTION_CORS_ORIGINS = 'http://localhost:3000,https://allowed.example.com';
}

const mockedPublicLimiter = jest.fn((req: any, res: any, next: any) => next());

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
  publicLimiter: mockedPublicLimiter,
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
    expect(res.body.services.redis.status).toEqual('UP');
    expect(typeof res.body.services.redis.latencyMs).toBe('number');
  });

  it('should return DOWN on health check when database is down', async () => {
    (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error('DB Connection Refused'));

    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(503);
    expect(res.body.status).toEqual('DOWN');
    expect(res.body.services.database).toEqual('DOWN');
    expect(res.body.services.redis.status).toEqual('UP');
  });

  it('should return DOWN on health check when Redis is down', async () => {
    jest.spyOn(redis, 'ping').mockRejectedValue(new Error('Redis Timeout'));

    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(503);
    expect(res.body.status).toEqual('DOWN');
    expect(res.body.services.database).toEqual('UP');
    expect(res.body.services.redis.status).toEqual('DOWN');
  });

  it('should return 200 on root access', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.text).toContain('AnchorPoint Backend API is running.');
  });

  it('should set Helmet security headers (CSP, HSTS, frame-guard)', async () => {
    const res = await request(app).get('/');

    expect(res.headers['content-security-policy']).toEqual(
      "default-src 'self';frame-ancestors 'none';object-src 'none'"
    );
    expect(res.headers['strict-transport-security']).toEqual('max-age=31536000; includeSubDomains; preload');
    expect(res.headers['x-frame-options']).toEqual('DENY');
    expect(res.headers['x-content-type-options']).toEqual('nosniff');
    expect(res.headers['referrer-policy']).toEqual('no-referrer');
    expect(res.headers['x-xss-protection']).toEqual('0');
    expect(res.headers['x-download-options']).toEqual('noopen');
    expect(res.headers['x-permitted-cross-domain-policies']).toEqual('none');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('should include CORS header for allowed origin', async () => {
    const res = await request(app)
      .get('/')
      .set('Origin', 'http://localhost:3000');

    expect(res.statusCode).toEqual(200);
    expect(res.headers['access-control-allow-origin']).toEqual('http://localhost:3000');
  });

  it('should not include CORS header for blocked origin', async () => {
    const res = await request(app)
      .get('/')
      .set('Origin', 'https://blocked.example.com');

    expect(res.statusCode).toEqual(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('should mount each public route exactly once with publicLimiter', () => {
    const publicPaths = ['/sep31', '/sep38', '/info', '/sep24', '/sep6', '/metrics'];
    const stack = (app as any)._router?.stack ?? [];

    for (const path of publicPaths) {
      const matchingLayers = stack.filter((layer: any) => (
        layer?.regexp instanceof RegExp && layer.regexp.test(path)
      ));
      const limiterLayers = matchingLayers.filter((layer: any) => layer.handle === mockedPublicLimiter);
      const routerLayers = matchingLayers.filter((layer: any) => layer.name === 'router');

      expect(limiterLayers).toHaveLength(1);
      expect(routerLayers).toHaveLength(1);
    }
  });

  it('should mount SEP-1 stellar.toml and SEP-10 /auth challenge routes', () => {
    const stack = (app as any)._router?.stack ?? [];
    const hasToml = stack.some((layer: any) => (
      layer?.regexp instanceof RegExp && layer.regexp.test('/.well-known/stellar.toml')
    ));
    const hasAuth = stack.some((layer: any) => (
      layer?.regexp instanceof RegExp && layer.regexp.test('/auth')
    ));

    expect(hasToml).toBe(true);
    expect(hasAuth).toBe(true);
  });
});
