import { Redis } from 'ioredis';
import logger from '../utils/logger';

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
  source: string;
  version: number;
}

export interface CacheOptions {
  ttlSeconds: number;
  tags?: string[];
  staleWhileRevalidate?: boolean;
  staleTtlSeconds?: number;
}

export interface CacheAsideResult<T> {
  data: T;
  fromCache: boolean;
  stale?: boolean;
}

export interface MultiLevelCacheConfig {
  l1MaxSize: number;
  l1TtlSeconds: number;
  l2TtlSeconds: number;
  staleWhileRevalidateTtlSeconds: number;
}

interface L1CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleAt?: number;
  key: string;
}

export class AdvancedCacheService {
  private l1Cache: Map<string, L1CacheEntry<unknown>>;
  private l1Keys: string[];
  private config: MultiLevelCacheConfig;
  private pubClient: Redis;
  private subClient: Redis;
  private invalidationCallbacks: Map<string, Set<(key: string) => void>>;
  private isSubscribed = false;

  constructor(
    private redis: Redis,
    config?: Partial<MultiLevelCacheConfig>
  ) {
    this.config = {
      l1MaxSize: 1000,
      l1TtlSeconds: 30,
      l2TtlSeconds: 300,
      staleWhileRevalidateTtlSeconds: 60,
      ...config,
    };
    this.l1Cache = new Map();
    this.l1Keys = [];
    this.invalidationCallbacks = new Map();

    this.pubClient = redis.duplicate();
    this.subClient = redis.duplicate();

    this.setupPubSub();
  }

  private setupPubSub(): void {
    if (this.isSubscribed) return;

    this.subClient.subscribe('cache:invalidate', (err) => {
      if (err) {
        logger.error('Failed to subscribe to cache invalidation channel:', err);
      } else {
        logger.info('Subscribed to cache invalidation channel');
        this.isSubscribed = true;
      }
    });

    this.subClient.on('message', (channel, message) => {
      if (channel === 'cache:invalidate') {
        try {
          const { key, pattern, tags } = JSON.parse(message);
          this.handleInvalidationMessage({ key, pattern, tags });
        } catch (err) {
          logger.error('Failed to parse invalidation message:', err);
        }
      }
    });
  }

  private handleInvalidationMessage(message: { key?: string; pattern?: string; tags?: string[] }): void {
    if (message.key) {
      this.invalidateL1(message.key);
      this.notifyInvalidationCallbacks(message.key);
    }

    if (message.pattern) {
      const regex = new RegExp(message.pattern);
      for (const [key] of this.l1Cache) {
        if (regex.test(key)) {
          this.invalidateL1(key);
          this.notifyInvalidationCallbacks(key);
        }
      }
    }

    if (message.tags) {
      for (const [key, entry] of this.l1Cache) {
        if (this.entryHasTags(entry, message.tags)) {
          this.invalidateL1(key);
          this.notifyInvalidationCallbacks(key);
        }
      }
    }
  }

  private entryHasTags(entry: L1CacheEntry<unknown>, tags: string[]): boolean {
    const metadata = this.getEntryMetadata(entry.key);
    if (!metadata?.tags) return false;
    return tags.some((tag) => metadata.tags!.includes(tag));
  }

  private getEntryMetadata(key: string): { tags?: string[] } | null {
    return null;
  }

  private notifyInvalidationCallbacks(key: string): void {
    const callbacks = this.invalidationCallbacks.get(key);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(key);
        } catch (err) {
          logger.error('Invalidation callback error:', err);
        }
      });
    }
  }

  private invalidateL1(key: string): void {
    this.l1Cache.delete(key);
    const index = this.l1Keys.indexOf(key);
    if (index > -1) {
      this.l1Keys.splice(index, 1);
    }
  }

  private enforceL1SizeLimit(): void {
    while (this.l1Keys.length > this.config.l1MaxSize) {
      const oldestKey = this.l1Keys.shift();
      if (oldestKey) {
        this.l1Cache.delete(oldestKey);
      }
    }
  }

  private getL1<T>(key: string): { entry: L1CacheEntry<T>; stale: boolean } | null {
    const entry = this.l1Cache.get(key) as L1CacheEntry<T> | undefined;
    if (!entry) return null;

    const now = Date.now();
    if (entry.staleAt && now > entry.staleAt) {
      return { entry, stale: true };
    }

    if (now > entry.expiresAt) {
      this.invalidateL1(key);
      return null;
    }

    return { entry, stale: false };
  }

  private setL1<T>(key: string, value: T, ttlSeconds: number, options?: CacheOptions): void {
    const now = Date.now();
    const entry: L1CacheEntry<T> = {
      key,
      value,
      expiresAt: now + ttlSeconds * 1000,
    };

    if (options?.staleWhileRevalidate) {
      entry.staleAt = now + ttlSeconds * 1000;
      entry.expiresAt = now + (ttlSeconds + (options.staleTtlSeconds || this.config.staleWhileRevalidateTtlSeconds)) * 1000;
    }

    if (this.l1Cache.has(key)) {
      const index = this.l1Keys.indexOf(key);
      if (index > -1) {
        this.l1Keys.splice(index, 1);
      }
    }

    this.l1Cache.set(key, entry as L1CacheEntry<unknown>);
    this.l1Keys.push(key);
    this.enforceL1SizeLimit();
  }

  async getL2<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const data = await this.redis.get(`cache:l2:${key}`);
      if (!data) return null;

      const entry: CacheEntry<T> = JSON.parse(data);
      if (Date.now() > entry.timestamp + entry.ttl * 1000) {
        await this.redis.del(`cache:l2:${key}`);
        return null;
      }

      return entry;
    } catch (err) {
      logger.error('L2 cache get error:', err);
      return null;
    }
  }

  async setL2<T>(key: string, value: T, ttlSeconds: number, source: string, tags?: string[]): Promise<void> {
    try {
      const entry: CacheEntry<T> = {
        value,
        timestamp: Date.now(),
        ttl: ttlSeconds,
        source,
        version: Date.now(),
      };

      await this.redis.setex(`cache:l2:${key}`, ttlSeconds, JSON.stringify(entry));

      if (tags && tags.length > 0) {
        const pipeline = this.redis.pipeline();
        tags.forEach((tag) => {
          pipeline.sadd(`cache:tag:${tag}`, key);
        });
        await pipeline.exec();
      }
    } catch (err) {
      logger.error('L2 cache set error:', err);
    }
  }

  async cacheAside<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOptions
  ): Promise<CacheAsideResult<T>> {
    const l1Result = this.getL1<T>(key);
    if (l1Result && !l1Result.stale) {
      return { data: l1Result.entry.value, fromCache: true };
    }

    const l2Entry = await this.getL2<T>(key);
    if (l2Entry) {
      this.setL1(key, l2Entry.value, this.config.l1TtlSeconds, options);

      if (l1Result?.stale) {
        this.refreshInBackground(key, fetchFn, options);
        return { data: l2Entry.value, fromCache: true, stale: true };
      }

      return { data: l2Entry.value, fromCache: true };
    }

    try {
      const data = await fetchFn();
      await this.setMultiLevel(key, data, options);
      return { data, fromCache: false };
    } catch (err) {
      if (l1Result?.stale || l2Entry) {
        const cachedValue = l1Result?.entry.value ?? l2Entry!.value;
        logger.warn(`Fetch failed for ${key}, returning stale data`);
        return { data: cachedValue, fromCache: true, stale: true };
      }
      throw err;
    }
  }

  async writeThrough<T>(
    key: string,
    value: T,
    writeFn: () => Promise<void>,
    options: CacheOptions
  ): Promise<void> {
    await writeFn();
    await this.setMultiLevel(key, value, options);
  }

  async writeBehind<T>(
    key: string,
    value: T,
    writeFn: () => Promise<void>,
    options: CacheOptions
  ): Promise<void> {
    await this.setMultiLevel(key, value, options);

    setImmediate(async () => {
      try {
        await writeFn();
      } catch (err) {
        logger.error(`Write-behind failed for ${key}:`, err);
        await this.invalidate(key);
      }
    });
  }

  private async refreshInBackground<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOptions
  ): Promise<void> {
    setImmediate(async () => {
      try {
        const data = await fetchFn();
        await this.setMultiLevel(key, data, options);
      } catch (err) {
        logger.error(`Background refresh failed for ${key}:`, err);
      }
    });
  }

  private async setMultiLevel<T>(key: string, value: T, options: CacheOptions): Promise<void> {
    this.setL1(key, value, options.ttlSeconds, options);
    await this.setL2(key, value, this.config.l2TtlSeconds, 'multi-level', options.tags);
  }

  async invalidate(key: string): Promise<void> {
    this.invalidateL1(key);
    await this.redis.del(`cache:l2:${key}`);

    try {
      await this.pubClient.publish(
        'cache:invalidate',
        JSON.stringify({ key })
      );
    } catch (err) {
      logger.error('Failed to publish invalidation:', err);
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    const regex = new RegExp(pattern);
    for (const [key] of this.l1Cache) {
      if (regex.test(key)) {
        this.invalidateL1(key);
      }
    }

    try {
      await this.pubClient.publish(
        'cache:invalidate',
        JSON.stringify({ pattern })
      );
    } catch (err) {
      logger.error('Failed to publish pattern invalidation:', err);
    }
  }

  async invalidateByTags(tags: string[]): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      tags.forEach((tag) => {
        pipeline.smembers(`cache:tag:${tag}`);
      });

      const results = await pipeline.exec();
      const keysToInvalidate = new Set<string>();

      results?.forEach((result, index) => {
        if (result[0]) {
          logger.error(`Error getting keys for tag ${tags[index]}:`, result[0]);
          return;
        }
        const keys = result[1] as string[];
        keys.forEach((key) => keysToInvalidate.add(key));
      });

      const delPipeline = this.redis.pipeline();
      keysToInvalidate.forEach((key) => {
        this.invalidateL1(key);
        delPipeline.del(`cache:l2:${key}`);
      });

      tags.forEach((tag) => {
        delPipeline.del(`cache:tag:${tag}`);
      });

      await delPipeline.exec();

      await this.pubClient.publish(
        'cache:invalidate',
        JSON.stringify({ tags })
      );
    } catch (err) {
      logger.error('Failed to invalidate by tags:', err);
    }
  }

  onInvalidate(key: string, callback: (key: string) => void): () => void {
    if (!this.invalidationCallbacks.has(key)) {
      this.invalidationCallbacks.set(key, new Set());
    }
    this.invalidationCallbacks.get(key)!.add(callback);

    return () => {
      this.invalidationCallbacks.get(key)?.delete(callback);
    };
  }

  async clear(): Promise<void> {
    this.l1Cache.clear();
    this.l1Keys = [];

    const keys = await this.redis.keys('cache:l2:*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  getStats(): { l1Size: number; l1MaxSize: number } {
    return {
      l1Size: this.l1Cache.size,
      l1MaxSize: this.config.l1MaxSize,
    };
  }

  async disconnect(): Promise<void> {
    await this.subClient.unsubscribe('cache:invalidate');
    await this.subClient.quit();
    await this.pubClient.quit();
  }
}
