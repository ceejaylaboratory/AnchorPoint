// CIRCUIT BREAKER APPROACH: Option B — breaker-wrapped service proxies
// Rationale: Option B encapsulates the circuit breaker logic within a proxy class. Callers use the proxies exactly as they would the raw clients, guaranteeing safety by default, preventing accidental bypasses, and keeping business logic completely decoupled from infrastructure failure handling.
// NOTE: Redis breaker opening must not crash the application — it must degrade silently.

import { BreakerOptions, createBreaker } from './circuit-breaker.factory';
import logger from '../utils/logger';
import { redis } from '../lib/redis';

/** Default time (ms) an open Redis breaker waits before probing Redis again. */
export const DEFAULT_REDIS_BREAKER_RESET_TIMEOUT_MS = 30000;

/**
 * Resolves the Redis breaker `resetTimeout` from `REDIS_BREAKER_RESET_TIMEOUT_MS`.
 *
 * Without a positive `resetTimeout` an open breaker never moves to HALF_OPEN,
 * so it would keep serving fallbacks after Redis reconnects. Invalid values
 * fall back to the default instead of disabling recovery.
 */
export function resolveRedisBreakerResetTimeout(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.REDIS_BREAKER_RESET_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_REDIS_BREAKER_RESET_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    logger.warn(
      `Invalid REDIS_BREAKER_RESET_TIMEOUT_MS "${raw}"; using ${DEFAULT_REDIS_BREAKER_RESET_TIMEOUT_MS}ms so the Redis breaker can recover`
    );
    return DEFAULT_REDIS_BREAKER_RESET_TIMEOUT_MS;
  }

  return parsed;
}

type RedisCommandClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
};

export class RedisProxy {
  private getBreaker;
  private setBreaker;
  private delBreaker;
  private existsBreaker;

  constructor(client: RedisCommandClient = redis as unknown as RedisCommandClient, options: Partial<BreakerOptions> = {}) {
    // resetTimeout is set explicitly so an open breaker always half-opens and
    // probes Redis again, closing once Redis has reconnected.
    const breakerOptions: Partial<BreakerOptions> = {
      ...options,
      resetTimeout: options.resetTimeout ?? resolveRedisBreakerResetTimeout(),
    };

    this.getBreaker = createBreaker('redis:get', async (key: string) => await client.get(key), breakerOptions);
    this.setBreaker = createBreaker(
      'redis:set',
      async (key: string, value: string, ...args: any[]) => await client.set(key, value, ...args),
      breakerOptions
    );
    this.delBreaker = createBreaker('redis:del', async (key: string) => await client.del(key), breakerOptions);
    this.existsBreaker = createBreaker('redis:exists', async (key: string) => await client.exists(key), breakerOptions);

    // Fallback for all read operations — return null (cache miss, caller degrades gracefully).
    this.getBreaker.fallback(async (key: string, error: Error) => {
      logger.warn(`[redis:get] Circuit breaker triggered. Reason: ${error.message}. Returning null cache miss.`);
      return null;
    });

    this.existsBreaker.fallback(async (key: string, error: Error) => {
      logger.warn(`[redis:exists] Circuit breaker triggered. Reason: ${error.message}. Returning 0.`);
      return 0; // ioredis exists returns number
    });

    // Fallback for write operations — log and swallow (cache write failure is non-critical).
    this.setBreaker.fallback(async (key: string, value: string, error: Error) => {
      logger.warn(`[redis:set] Circuit breaker triggered. Reason: ${error.message}. Swallowing error.`);
      return 'OK'; // Swallow and pretend it worked
    });

    this.delBreaker.fallback(async (key: string, error: Error) => {
      logger.warn(`[redis:del] Circuit breaker triggered. Reason: ${error.message}. Swallowing error.`);
      return 0; // Pretend 0 keys were deleted
    });
  }

  public async get(key: string) {
    return this.getBreaker.fire(key);
  }

  public async set(key: string, value: string, ...args: any[]) {
    return this.setBreaker.fire(key, value, ...args);
  }

  public async del(key: string) {
    return this.delBreaker.fire(key);
  }

  public async exists(key: string) {
    return this.existsBreaker.fire(key);
  }
}

export const redisProxy = new RedisProxy();
