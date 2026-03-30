import { rateLimit } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../../lib/redis';
import logger from '../../utils/logger';
import { Request, Response, NextFunction } from 'express';

/**
 * Interface for rate limit options
 */
export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  keyPrefix?: string;
}

/**
 * Create a rate limiting middleware with Redis storage
 * @param options Rate limit configuration
 * @returns Express middleware
 */
export const createRateLimiter = (options: RateLimitOptions = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // Default 15 minutes
    max = 100, // Default 100 requests per windowMs
    message = 'Too many requests from this IP, please try again later.',
    keyPrefix = 'rl:',
  } = options;

  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    // Redis store configuration
    store: new RedisStore({
      // @ts-ignore
      sendCommand: (...args: string[]) => redis.call(...args),
      prefix: keyPrefix,
    }),
    handler: (req: Request, res: Response, _next: NextFunction, options: any) => {
      logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
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
