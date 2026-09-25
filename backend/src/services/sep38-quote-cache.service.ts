import { Redis } from 'ioredis';
import cron, { ScheduledTask } from 'node-cron';
import logger from '../utils/logger';

const QUOTE_KEY_PREFIX = 'sep38:quote:';
const QUOTE_INDEX_KEY = 'sep38:quote:index';

export type CachedQuotePayload = Record<string, unknown>;

/**
 * Caches SEP-38 firm RFQ quotes in Redis, keyed by quote id, so repeat
 * lookups don't have to round-trip to Postgres while the quote is still
 * valid. Each entry carries its own Redis TTL matching the quote's
 * remaining validity window (`SETEX sep38:quote:<id> ttl_seconds payload`).
 */
export class Sep38QuoteCacheService {
  constructor(private redis: Redis) {}

  /**
   * Store a quote payload in Redis with an expiry matching its remaining
   * validity window. Also records the id + expiry in a sorted-set index so
   * `cleanupExpiredQuotes` can prune stale entries even if a caller never
   * reads the key again.
   */
  async cacheQuote(id: string, payload: CachedQuotePayload, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;

    await this.redis.setex(this.buildKey(id), ttlSeconds, JSON.stringify(payload));
    await this.redis.zadd(QUOTE_INDEX_KEY, Date.now() + ttlSeconds * 1000, id);
  }

  /** Retrieve a cached quote by id, or `null` if not cached or expired. */
  async getQuote<T = CachedQuotePayload>(id: string): Promise<T | null> {
    const raw = await this.redis.get(this.buildKey(id));
    if (!raw) return null;

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      logger.error(
        `Failed to parse cached SEP-38 quote ${id}:`,
        error instanceof Error ? error : new Error(String(error)),
      );
      return null;
    }
  }

  /** Remove a quote from the cache immediately (e.g. once it's consumed). */
  async invalidateQuote(id: string): Promise<void> {
    await this.redis.del(this.buildKey(id));
    await this.redis.zrem(QUOTE_INDEX_KEY, id);
  }

  /**
   * Purge index entries for quotes whose recorded expiry has passed.
   *
   * Redis already expires the `sep38:quote:<id>` string keys on their own
   * TTL; this keeps the auxiliary index from growing unbounded with ids
   * whose keys have already expired.
   *
   * @returns The number of expired index entries removed.
   */
  async cleanupExpiredQuotes(now: number = Date.now()): Promise<number> {
    const expiredIds = await this.redis.zrangebyscore(QUOTE_INDEX_KEY, 0, now);
    if (expiredIds.length === 0) return 0;

    await this.redis.zrem(QUOTE_INDEX_KEY, ...expiredIds);
    return expiredIds.length;
  }

  private buildKey(id: string): string {
    return `${QUOTE_KEY_PREFIX}${id}`;
  }
}

/**
 * Periodically purges expired entries from the SEP-38 quote cache index.
 * Runs every minute, mirroring `CleanupWorker`'s start/stop shape.
 */
export class Sep38QuoteCacheCleanupWorker {
  private task: ScheduledTask | null = null;

  constructor(private cache: Sep38QuoteCacheService) {}

  start(): void {
    this.task = cron.schedule('0 * * * * *', async () => {
      try {
        await this.cache.cleanupExpiredQuotes();
      } catch (error) {
        logger.error('Failed to run SEP-38 quote cache cleanup task', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    logger.info('SEP-38 quote cache cleanup worker started (running every minute)');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    logger.info('SEP-38 quote cache cleanup worker stopped');
  }
}
