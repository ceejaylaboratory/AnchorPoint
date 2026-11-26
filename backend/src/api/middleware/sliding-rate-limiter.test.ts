import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import {
  createSlidingRateLimiter,
  recordSlidingWindowHit,
  resolveRateLimitIdentity,
  type SlidingWindowRedisClient,
} from './sliding-rate-limiter';

class InMemorySortedSetRedis implements SlidingWindowRedisClient {
  private readonly sets = new Map<string, Array<{ score: number; member: string }>>();

  private entries(key: string): Array<{ score: number; member: string }> {
    let entries = this.sets.get(key);
    if (!entries) {
      entries = [];
      this.sets.set(key, entries);
    }
    return entries;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const entries = this.entries(key);
    entries.push({ score, member });
    return 1;
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    const entries = this.entries(key);
    const kept = entries.filter((entry) => entry.score < min || entry.score > max);
    const removed = entries.length - kept.length;
    this.sets.set(key, kept);
    return removed;
  }

  async zcard(key: string): Promise<number> {
    return this.entries(key).length;
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.entries(key)
      .slice(start, stop + 1)
      .map((entry) => entry.member);
  }

  async pexpire(): Promise<number> {
    return 1;
  }
}

describe('Sliding window rate limiter (#1586)', () => {
  let clock: number;
  let client: InMemorySortedSetRedis;
  let app: express.Express;

  const buildApp = (options: Partial<Parameters<typeof createSlidingRateLimiter>[0]> = {}) => {
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use(
      createSlidingRateLimiter({
        windowMs: 60_000,
        limit: 5,
        keyPrefix: 'test:',
        redis: client,
        now: () => clock,
        ...options,
      })
    );
    app.get('/public', (_req: Request, res: Response) => res.json({ ok: true }));
    return app;
  };

  beforeEach(() => {
    clock = 1_000_000;
    client = new InMemorySortedSetRedis();
    app = buildApp();
  });

  it('smooths boundary bursts instead of allowing a double quota', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await request(app).get('/public')).status).toBe(200);
    }

    clock += 59_999;
    const rejected = await request(app).get('/public');
    expect(rejected.status).toBe(429);
    expect(rejected.body.error).toContain('Too many requests');

    clock += 2;
    expect((await request(app).get('/public')).status).toBe(200);
  });

  it('emits IETF RateLimit headers with accurate remaining quota and reset', async () => {
    const first = await request(app).get('/public');
    expect(first.headers['ratelimit-limit']).toBe('5');
    expect(first.headers['ratelimit-remaining']).toBe('4');
    expect(Number(first.headers['ratelimit-reset'])).toBeGreaterThan(0);
    expect(Number(first.headers['ratelimit-reset'])).toBeLessThanOrEqual(60);

    for (let i = 0; i < 4; i += 1) await request(app).get('/public');
    const limited = await request(app).get('/public');
    expect(limited.status).toBe(429);
    expect(limited.headers['ratelimit-remaining']).toBe('0');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('tracks unauthenticated clients by IP and authenticated clients by principal', async () => {
    const scoped = buildApp({ limit: 2 });
    scoped.get('/user', (req: Request, res: Response) => {
      (req as any).user = { publicKey: 'GSTELLARPUBLICKEY' };
      res.json({ ok: true });
    });

    await request(scoped).get('/public').set('X-Forwarded-For', '203.0.113.1').expect(200);
    await request(scoped).get('/public').set('X-Forwarded-For', '203.0.113.2').expect(200);
    await request(scoped).get('/public').set('X-Forwarded-For', '203.0.113.1').expect(200);

    const principal = resolveRateLimitIdentity(
      { user: { publicKey: 'GSTELLARPUBLICKEY' }, ip: '203.0.113.1' } as unknown as Request,
      'auto'
    );
    expect(principal).toBe('user:GSTELLARPUBLICKEY');
    expect(resolveRateLimitIdentity({ ip: '203.0.113.1' } as Request, 'auto')).toBe(
      'ip:203.0.113.1'
    );
  });

  it('grants whitelisted partners their configured quota tier', async () => {
    const partnerApp = express();
    partnerApp.use((req: Request, _res: Response, next: NextFunction) => {
      (req as any).whitelistedPartner = true;
      next();
    });
    partnerApp.use(
      createSlidingRateLimiter({
        windowMs: 60_000,
        limit: 2,
        partnerLimit: 10,
        keyPrefix: 'test:partner:',
        redis: client,
        now: () => clock,
      })
    );
    partnerApp.get('/partner', (_req: Request, res: Response) => res.json({ ok: true }));

    for (let i = 0; i < 5; i += 1) {
      const res = await request(partnerApp).get('/partner');
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('10');
    }
  });

  it('expires old entries from the sorted set and reports reset accurately', async () => {
    const key = 'test:record';
    const first = await recordSlidingWindowHit(client, key, 60_000, 1_000_000);
    expect(first.count).toBe(1);
    expect(first.resetMs).toBe(60_000);

    clock = 1_030_000;
    const second = await recordSlidingWindowHit(client, key, 60_000, clock);
    expect(second.count).toBe(2);
    expect(second.resetMs).toBe(30_000);
  });

  it('bypasses health and docs paths', async () => {
    const scoped = buildApp();
    scoped.get('/health', (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 10; i += 1) await request(scoped).get('/health').expect(200);
  });
});
