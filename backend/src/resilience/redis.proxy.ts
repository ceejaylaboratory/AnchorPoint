// CIRCUIT BREAKER APPROACH: Option B — breaker-wrapped service proxies
// Rationale: Option B encapsulates the circuit breaker logic within a proxy class. Callers use the proxies exactly as they would the raw clients, guaranteeing safety by default, preventing accidental bypasses, and keeping business logic completely decoupled from infrastructure failure handling.
// NOTE: Redis breaker opening must not crash the application — it must degrade silently.

import { createBreaker } from './circuit-breaker.factory';
import logger from '../utils/logger';
import { redis } from '../lib/redis';

export class RedisProxy {
  private getBreaker;
  private setBreaker;
  private delBreaker;
  private existsBreaker;

  constructor() {
    this.getBreaker = createBreaker('redis:get', async (key: string) => await redis.get(key));
    this.setBreaker = createBreaker('redis:set', async (key: string, value: string, ...args: any[]) => await redis.set(key, value, ...args));
    this.delBreaker = createBreaker('redis:del', async (key: string) => await redis.del(key));
    this.existsBreaker = createBreaker('redis:exists', async (key: string) => await redis.exists(key));

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
