import { rateLimit } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../../lib/redis';
import logger from '../../utils/logger';
import { Request, Response, NextFunction } from 'express';
import * as StellarSdk from '@stellar/stellar-sdk';
import { config } from '../../config/env';

const HEALTH_SKIP_PATHS = ['/health', '/api-docs', '/api-docs.json'];

/**
 * Interface for rate limit options
 */
export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  keyPrefix?: string;
  /** Paths that bypass rate limiting entirely (in addition to the default health/docs paths) */
  skipPaths?: string[];
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
  } = options;

  const allSkipPaths = [...HEALTH_SKIP_PATHS, ...skipPaths];

  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req: Request) => allSkipPaths.some(p => req.path === p || req.path.startsWith(p)),
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
      prefix: keyPrefix,
    }),

    handler: (req: Request, res: Response, _next: NextFunction, options: any) => {
      logger.warn(`Rate limit exceeded`, { ip: req.ip, path: req.path, keyPrefix });
      res.status(options.statusCode).send(options.message);
    },
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

/**
 * Configuration for the submission rate limiter
 */
export const submissionLimiterOptions = {
  windowMs: 60 * 1000, // 1 minute window
  max: 5, // 5 requests per window
  message: { error: 'Rate limit exceeded for this Stellar account. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args: string[]) => redis.call(...args),
    prefix: 'rl:submit:',
  }),
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


