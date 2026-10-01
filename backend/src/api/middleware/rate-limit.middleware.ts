import { rateLimit, MemoryStore, Store } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../../lib/redis';
import logger from '../../utils/logger';
import { Request, Response, NextFunction } from 'express';
import * as StellarSdk from '@stellar/stellar-sdk';
import { config } from '../../config/env';

/**
 * Wraps a Redis-backed store and transparently falls back to an in-memory
 * store for any call whose Redis command throws (e.g. Redis is unreachable),
 * so rate limiting keeps working — per-instance rather than shared across
 * processes — instead of the request failing outright during an outage.
 */
export class RedisWithMemoryFallbackStore implements Store {
  constructor(
    private redisStore: RedisStore,
    private memoryStore: MemoryStore = new MemoryStore(),
  ) {}

  init(options: Parameters<NonNullable<Store['init']>>[0]): void {
    this.redisStore.init?.(options);
    this.memoryStore.init?.(options);
  }

  async increment(key: string) {
    try {
      return await this.redisStore.increment(key);
    } catch (error) {
      logger.warn('Rate limiter Redis store failed, falling back to in-memory store', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.memoryStore.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.redisStore.decrement(key);
    } catch (error) {
      logger.warn('Rate limiter Redis store failed, falling back to in-memory store', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.memoryStore.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.redisStore.resetKey(key);
    } catch (error) {
      logger.warn('Rate limiter Redis store failed, falling back to in-memory store', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.memoryStore.resetKey(key);
    }
  }
}

const HEALTH_SKIP_PATHS = ['/health', '/api-docs', '/api-docs.json'];

export type Tier = 'Free' | 'Pro' | 'Enterprise';

export const TIER_LIMITS: Record<Tier, { windowMs: number; max: number }> = {
  Free: { windowMs: 60 * 1000, max: 60 },
  Pro: { windowMs: 60 * 1000, max: 600 },
  Enterprise: { windowMs: 60 * 1000, max: 3000 },
};

export const TIER_AUTH_LIMITS: Record<Tier, { windowMs: number; max: number }> = {
  Free: { windowMs: 10 * 60 * 1000, max: 10 },
  Pro: { windowMs: 10 * 60 * 1000, max: 50 },
  Enterprise: { windowMs: 10 * 60 * 1000, max: 200 },
};

export const TIER_SENSITIVE_LIMITS: Record<Tier, { windowMs: number; max: number }> = {
  Free: { windowMs: 60 * 1000, max: 5 },
  Pro: { windowMs: 60 * 1000, max: 20 },
  Enterprise: { windowMs: 60 * 1000, max: 100 },
};

/**
 * Interface for rate limit options
 */
export interface RateLimitOptions {
  windowMs?: number;
  max?: number | ((req: Request) => number);
  message?: string;
  keyPrefix?: string;
  /** Paths that bypass rate limiting entirely (in addition to the default health/docs paths) */
  skipPaths?: string[];
  /** Tier limit map for dynamic rate limiting */
  tierLimits?: Record<string, { windowMs: number; max: number }>;
  /** Emit RateLimit-* headers (IETF draft). Defaults to true. */
  standardHeaders?: boolean;
  /** Emit X-RateLimit-* headers. Defaults to false. */
  legacyHeaders?: boolean;
}

function resolveMax(max: number | ((req: Request) => number) | undefined, req: Request): number {
  if (typeof max === 'function') {
    return max(req);
  }
  return max ?? 100;
}

function resolveTierFromRequest(req: Request): Tier {
  const tier =
    (req as any).apiTier ||
    (req as any).apiKeyTier ||
    (req as any).user?.tier ||
    'Free';
  if (tier in TIER_LIMITS) {
    return tier as Tier;
  }
  return 'Free';
}

/**
 * Create a rate limiting middleware with Redis storage
 * @param options Rate limit configuration
 * @returns Express middleware
 */
export const createRateLimiter = (options: RateLimitOptions = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = 'Too many requests from this IP, please try again later.',
    keyPrefix = 'rl:',
    skipPaths = [],
    tierLimits,
    standardHeaders = true,
    legacyHeaders = false,
  } = options;

  const allSkipPaths = [...HEALTH_SKIP_PATHS, ...skipPaths];

  const effectiveMax = tierLimits
    ? (req: Request) => {
        const tier = resolveTierFromRequest(req);
        const limits = tierLimits[tier] ?? tierLimits['Free'];
        return limits?.max ?? (typeof max === 'number' ? max : 100);
      }
    : max;

  const effectiveWindowMs = tierLimits
    ? (Object.values(tierLimits)[0]?.windowMs ?? windowMs)
    : windowMs;

  return rateLimit({
    windowMs: effectiveWindowMs,
    max: effectiveMax,
    message: { error: message },
    standardHeaders,
    legacyHeaders,
    skip: (req: Request) => allSkipPaths.some(p => req.path === p || req.path.startsWith(p)),
    store: new RedisWithMemoryFallbackStore(
      new RedisStore({
        sendCommand: (...args: string[]) => (redis as any).call(...args),
        prefix: keyPrefix,
      }),
    ),

    handler: (req: Request, res: Response, _next: NextFunction, options: any) => {
      logger.warn(`Rate limit exceeded`, { ip: req.ip, path: req.path, keyPrefix });

      const retryAfter = Math.ceil(effectiveWindowMs / 1000);
      const resetTime = new Date(Date.now() + retryAfter * 1000);

      res.set('Retry-After', String(retryAfter));
      res.set('X-RateLimit-Reset', String(Math.floor(resetTime.getTime() / 1000)));
      res.status(options.statusCode).send(options.message);
    },
  });
};

export const createTieredRateLimiter = (tierLimits: Record<string, { windowMs: number; max: number }>, options: Partial<RateLimitOptions> = {}) => {
  return createRateLimiter({
    ...options,
    tierLimits,
  });
};

// Common rate limiters
export const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  keyPrefix: 'rl:api:',
});

export const authLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts, please try again after 10 minutes.',
  keyPrefix: 'rl:auth:',
});

export const sep10ChallengeLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many challenge requests, please try again later.',
  keyPrefix: 'rl:sep10:challenge:',
  legacyHeaders: true,
});

export const sensitiveApiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Too many requests to this sensitive endpoint, please try again later.',
  keyPrefix: 'rl:sensitive:',
});

export const publicLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests to this public endpoint, please try again later.',
  keyPrefix: 'rl:public:',
});

// Tier-aware rate limiters — dynamically adjust limits based on request.apiTier
export const tieredApiLimiter = createTieredRateLimiter(TIER_LIMITS, {
  message: 'Rate limit exceeded for your API tier. Please upgrade or try again later.',
  keyPrefix: 'rl:tier:api:',
});

export const tieredAuthLimiter = createTieredRateLimiter(TIER_AUTH_LIMITS, {
  message: 'Too many authentication attempts. Please try again later.',
  keyPrefix: 'rl:tier:auth:',
});

export const tieredSensitiveLimiter = createTieredRateLimiter(TIER_SENSITIVE_LIMITS, {
  message: 'Too many requests to this sensitive endpoint. Please try again later.',
  keyPrefix: 'rl:tier:sensitive:',
});

/**
 * Configuration for the submission rate limiter
 */
export const submissionLimiterOptions = {
  windowMs: 60 * 1000, // 1 minute window
  max: 5, // 5 requests per window
  message: { error: 'Rate limit exceeded for this Stellar account. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisWithMemoryFallbackStore(
    new RedisStore({
      sendCommand: (...args: string[]) => (redis as any).call(...args),
      prefix: 'rl:submit:',
    }),
  ),
  keyGenerator: (req: Request) => {
    try {
      if (req.body && req.body.xdr) {
        const tx = StellarSdk.TransactionBuilder.fromXDR(req.body.xdr, config.STELLAR_NETWORK_PASSPHRASE);
        if (tx instanceof StellarSdk.FeeBumpTransaction) {
          return tx.innerTransaction.source;
        }
        return tx.source;
      }
    } catch (e) {
      logger.debug('Failed to parse XDR for rate-limit key, falling back to IP', { error: (e as Error).message });
    }
    return req.ip || 'unknown';
  },
};

/**
 * Rate limiter for transaction submission, keyed by Stellar source account
 */
export const submissionLimiter = rateLimit(submissionLimiterOptions);


