import { redis } from '../lib/redis';
import { RedisService } from './redis.service';
import logger from '../utils/logger';

/**
 * Cache key used for the SEP-1 info / stellar.toml response.
 * The version suffix makes it trivial to invalidate all cached entries
 * globally when the schema changes (bump the version).
 */
const CACHE_KEY = 'sep1:info:v1';

/**
 * How long (in seconds) a cached SEP-1 response is considered fresh.
 * SEP-1 data is derived from environment variables and static asset
 * configuration, so a 5-minute TTL balances freshness with Redis load.
 */
const TTL_SECONDS = 300;

/**
 * Additional grace window (in seconds) during which a stale entry is
 * served while the cache is being refreshed in the background.
 * This prevents a thundering-herd problem when the TTL expires under load.
 */
const STALE_GRACE_SECONDS = 60;

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

export class Sep1InfoCacheService<T> {
  private readonly redisService: RedisService;

  constructor(redisClient = redis) {
    this.redisService = new RedisService(redisClient);
  }

  /**
   * Returns the raw CacheEntry from Redis, or null on miss / Redis error.
   */
  private async getCacheEntry(): Promise<CacheEntry<T> | null> {
    try {
      return await this.redisService.getJSON<CacheEntry<T>>(CACHE_KEY);
    } catch (err) {
      logger.warn('SEP-1 info cache read failed, falling back to fresh generation', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Cache-aside helper: returns a cached value when fresh, triggers a
   * background refresh on stale, or calls `computeFn` on full miss.
   *
   * Redis errors are swallowed — `computeFn` is always the safe fallback.
   */
  async getOrCompute(computeFn: () => T): Promise<T> {
    const entry = await this.getCacheEntry();

    if (entry) {
      const ageSeconds = (Date.now() - entry.cachedAt) / 1000;

      if (ageSeconds <= TTL_SECONDS) {
        logger.debug('SEP-1 info cache hit', { ageSeconds: Math.round(ageSeconds) });
        return entry.value;
      }

      if (ageSeconds <= TTL_SECONDS + STALE_GRACE_SECONDS) {
        // Serve stale immediately, refresh in background to avoid latency spike.
        logger.debug('SEP-1 info stale-while-revalidate', { ageSeconds: Math.round(ageSeconds) });
        setImmediate(() => {
          Promise.resolve()
            .then(() => this.set(computeFn()))
            .catch(err => {
              logger.warn('SEP-1 background cache refresh failed', {
                error: err instanceof Error ? err.message : 'Unknown error',
              });
            });
        });
        return entry.value;
      }
    }

    // Full cache miss or expired past grace window — compute synchronously.
    const value = computeFn();
    await this.set(value);
    return value;
  }

  /**
   * Returns a cached SEP-1 info payload when one exists and is still fresh.
   * Returns null on cache miss or when Redis is unavailable.
   */
  async get(): Promise<T | null> {
    const entry = await this.getCacheEntry();
    if (!entry) return null;
    const ageSeconds = (Date.now() - entry.cachedAt) / 1000;
    if (ageSeconds <= TTL_SECONDS + STALE_GRACE_SECONDS) return entry.value;
    return null;
  }

  /**
   * Returns true when the cached entry exists but has passed its TTL.
   */
  async isStale(): Promise<boolean> {
    const entry = await this.getCacheEntry();
    if (!entry) return false;
    const ageSeconds = (Date.now() - entry.cachedAt) / 1000;
    return ageSeconds > TTL_SECONDS && ageSeconds <= TTL_SECONDS + STALE_GRACE_SECONDS;
  }

  /**
   * Stores a fresh SEP-1 info payload.
   * TTL is set to TTL + grace so Redis evicts entries that are fully expired.
   */
  async set(value: T): Promise<void> {
    try {
      const entry: CacheEntry<T> = { value, cachedAt: Date.now() };
      await this.redisService.setJSON(CACHE_KEY, entry, TTL_SECONDS + STALE_GRACE_SECONDS);
      logger.debug('SEP-1 info cache written', { ttlSeconds: TTL_SECONDS });
    } catch (err) {
      // Cache write failures are non-fatal — the response was already computed.
      logger.warn('SEP-1 info cache write failed', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  /**
   * Removes the cached entry, forcing the next request to recompute from source.
   * Call this whenever environment configuration or asset definitions change.
   */
  async invalidate(): Promise<void> {
    try {
      await this.redisService.del(CACHE_KEY);
      logger.info('SEP-1 info cache invalidated');
    } catch (err) {
      logger.warn('SEP-1 info cache invalidation failed', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  /** Exposed for testing. */
  static get cacheKey(): string {
    return CACHE_KEY;
  }

  static get ttlSeconds(): number {
    return TTL_SECONDS;
  }

  static get staleGraceSeconds(): number {
    return STALE_GRACE_SECONDS;
  }
}

/** Singleton used by the info controller. */
export const sep1InfoCache = new Sep1InfoCacheService();
