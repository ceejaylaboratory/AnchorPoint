import { NextFunction, Request, Response } from 'express';
export interface SlidingWindowRedisClient {
  zadd(key: string, score: number, member: string): Promise<number>;
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zcard(key: string): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  pexpire(key: string, milliseconds: number): Promise<number>;
}

export type IdentitySource = 'auto' | 'ip' | 'user';

export interface SlidingRateLimitOptions {
  windowMs: number;
  limit: number;
  keyPrefix?: string;
  identitySource?: IdentitySource;
  /** Higher quota for whitelisted anchor partners. */
  partnerLimit?: number;
  /** Tier name -> request quota (e.g. Free/Pro/Enterprise/whitelisted). */
  tiers?: Record<string, number>;
  skipPaths?: string[];
  message?: string;
  redis?: SlidingWindowRedisClient;
  now?: () => number;
}

export interface SlidingWindowResult {
  count: number;
  oldestTimestamp: number;
  resetMs: number;
}

const DEFAULT_SKIP_PATHS = ['/health', '/health/live', '/health/ready', '/api-docs'];

/** Resolve the bucket identity: authenticated principal, otherwise client IP. */
export function resolveRateLimitIdentity(req: Request, source: IdentitySource = 'auto'): string {
  const user = (req as any).user as
    | { publicKey?: string; sub?: string; id?: string }
    | undefined;
  const principal =
    user?.publicKey ||
    user?.sub ||
    user?.id ||
    (req as any).stellarPublicKey ||
    (req as any).jwtSubject ||
    (req.body && typeof req.body === 'object'
      ? ((req.body as Record<string, unknown>).public_key as string | undefined)
      : undefined);

  if (source !== 'ip' && principal) return `user:${principal}`;
  return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

/** Resolve the quota, applying tier and whitelist overrides. */
export function resolveRateLimit(req: Request, options: SlidingRateLimitOptions): number {
  const request = req as any;
  const whitelisted =
    request.whitelistedPartner === true ||
    request.isWhitelisted === true ||
    request.partnerTier === 'whitelisted';
  if (whitelisted) return options.partnerLimit ?? options.tiers?.whitelisted ?? options.limit;

  const tier = request.apiTier || request.apiKeyTier || userTier(req) || 'standard';
  return options.tiers?.[tier] ?? options.limit;

  function userTier(requestWithUser: Request): string | undefined {
    const user = (requestWithUser as any).user as { tier?: string } | undefined;
    return user?.tier;
  }
}

/**
 * Record one hit in a Redis sorted set and return the current window state.
 * Expired entries are removed first, so requests spread across the boundary
 * cannot be counted twice.
 */
export async function recordSlidingWindowHit(
  client: SlidingWindowRedisClient,
  key: string,
  windowMs: number,
  now: number
): Promise<SlidingWindowResult> {
  const windowStart = now - windowMs;
  await client.zremrangebyscore(key, 0, windowStart);
  await client.zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`);
  const count = await client.zcard(key);
  await client.pexpire(key, windowMs);

  const oldest = (await client.zrange(key, 0, 0))[0];
  const oldestTimestamp = oldest ? Number(String(oldest).split(':')[0]) || now : now;
  return {
    count,
    oldestTimestamp,
    resetMs: Math.max(0, oldestTimestamp + windowMs - now),
  };
}

/**
 * Distributed sliding-window rate limiter backed by Redis sorted sets.
 * Emits the IETF draft `RateLimit-*` headers on every response.
 */
export const createSlidingRateLimiter = (options: SlidingRateLimitOptions) => {
  const {
    windowMs,
    keyPrefix = 'rl:sliding:',
    identitySource = 'auto',
    skipPaths = [],
    message = 'Too many requests, please try again later.',
    now = () => Date.now(),
  } = options;
  const skip = [...DEFAULT_SKIP_PATHS, ...skipPaths];

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (skip.some((path) => req.path === path || req.path.startsWith(path))) {
      next();
      return;
    }

    const quota = resolveRateLimit(req, options);
    const key = `${keyPrefix}${resolveRateLimitIdentity(req, identitySource)}`;
    const client =
      options.redis ??
      ((require('../../lib/redis').redis as unknown) as SlidingWindowRedisClient);

    try {
      const timestamp = now();
      const { count, resetMs } = await recordSlidingWindowHit(client, key, windowMs, timestamp);
      const resetSeconds = Math.max(1, Math.ceil(resetMs / 1000));
      const remaining = Math.max(0, quota - count);

      res.set('RateLimit-Limit', String(quota));
      res.set('RateLimit-Remaining', String(remaining));
      res.set('RateLimit-Reset', String(resetSeconds));

      if (count > quota) {
        res.set('Retry-After', String(resetSeconds));
        res.status(429).json({ error: message });
        return;
      }
      next();
    } catch (error) {
      const logger = (require('../../utils/logger') as { default: { warn: (message: string, meta?: object) => void } }).default;
      logger.warn('Sliding rate limiter Redis failure, allowing request', {
        error: error instanceof Error ? error.message : String(error),
        key,
      });
      next();
    }
  };
};

export const slidingApiLimiter = createSlidingRateLimiter({
  windowMs: 60_000,
  limit: 100,
  keyPrefix: 'rl:sliding:api:',
});

export const slidingAuthLimiter = createSlidingRateLimiter({
  windowMs: 10 * 60_000,
  limit: 10,
  keyPrefix: 'rl:sliding:auth:',
  identitySource: 'ip',
});

export const slidingPartnerLimiter = createSlidingRateLimiter({
  windowMs: 60_000,
  limit: 100,
  partnerLimit: 1000,
  keyPrefix: 'rl:sliding:partner:',
  tiers: { standard: 100, Free: 100, Pro: 500, Enterprise: 2000, whitelisted: 1000 },
});
