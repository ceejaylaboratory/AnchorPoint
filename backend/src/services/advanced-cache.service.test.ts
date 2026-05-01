import { AdvancedCacheService, CacheOptions, CircuitState } from './advanced-cache.service';

// Mock Redis
const createMockRedis = () => {
  const data = new Map<string, string>();
  const subscribers = new Map<string, Set<(channel: string, message: string) => void>>();

  return {
    get: jest.fn(async (key: string) => data.get(key) || null),
    set: jest.fn(async (key: string, value: string) => { data.set(key, value); }),
    setex: jest.fn(async (key: string, seconds: number, value: string) => {
      data.set(key, value);
    }),
    del: jest.fn(async (...keys: string[]) => {
      let count = 0;
      keys.forEach((key) => {
        if (data.delete(key)) count++;
      });
      return count;
    }),
    expire: jest.fn(async () => {}),
    keys: jest.fn(async () => Array.from(data.keys())),
    pipeline: jest.fn(() => ({
      sadd: jest.fn(function() { return this; }),
      smembers: jest.fn(function() { return this; }),
      exec: jest.fn(async () => []),
    })),
    smembers: jest.fn(async () => []),
    sadd: jest.fn(async () => 1),
    publish: jest.fn(async () => 1),
    subscribe: jest.fn(async (channel: string, callback: (err: Error | null) => void) => {
      callback(null);
    }),
    on: jest.fn((event: string, handler: unknown) => {
      if (event === 'message') {
        // Store message handler for testing
      }
    }),
    duplicate: jest.fn(function() { return this; }),
    quit: jest.fn(async () => {}),
    unsubscribe: jest.fn(async () => {}),
    _data: data,
    _subscribers: subscribers,
  };
};

describe('AdvancedCacheService', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let cache: AdvancedCacheService;

  beforeEach(() => {
    mockRedis = createMockRedis();
    cache = new AdvancedCacheService(mockRedis as unknown as Parameters<typeof AdvancedCacheService>[0], {
      l1MaxSize: 5,
      l1TtlSeconds: 10,
      l2TtlSeconds: 60,
      staleWhileRevalidateTtlSeconds: 30,
    });
  });

  afterEach(async () => {
    await cache.disconnect();
  });

  describe('L1 Cache (In-Memory)', () => {
    it('should store and retrieve values from L1 cache', async () => {
      const key = 'test-key';
      const value = { data: 'test-value' };

      await cache.setL2(key, value, 60, 'test');
      cache['setL1'](key, value, 10);

      const l1Result = cache['getL1']<typeof value>(key);
      expect(l1Result).not.toBeNull();
      expect(l1Result?.entry.value).toEqual(value);
      expect(l1Result?.stale).toBe(false);
    });

    it('should return null for expired L1 entries', async () => {
      const key = 'expired-key';
      const value = { data: 'expired-value' };

      // Set with immediate expiration
      cache['setL1'](key, value, -1);

      const result = cache['getL1']<typeof value>(key);
      expect(result).toBeNull();
    });

    it('should mark entries as stale when staleWhileRevalidate is enabled', async () => {
      const key = 'stale-key';
      const value = { data: 'stale-value' };

      // Set with short stale time
      cache['setL1'](key, value, 1, { staleWhileRevalidate: true, staleTtlSeconds: 1 });

      // Wait for stale period to pass
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const result = cache['getL1']<typeof value>(key);
      expect(result).not.toBeNull();
      expect(result?.stale).toBe(true);
    });

    it('should enforce L1 size limit with LRU eviction', () => {
      // Fill cache beyond max size
      for (let i = 0; i < 10; i++) {
        cache['setL1'](`key-${i}`, `value-${i}`, 60);
      }

      const stats = cache.getStats();
      expect(stats.l1Size).toBeLessThanOrEqual(stats.l1MaxSize);
    });
  });

  describe('L2 Cache (Redis)', () => {
    it('should store values with setL2', async () => {
      const key = 'l2-key';
      const value = { price: 100 };

      await cache.setL2(key, value, 60, 'test-source');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `cache:l2:${key}`,
        60,
        expect.stringContaining('"price":100')
      );
    });

    it('should retrieve values from L2 cache', async () => {
      const key = 'l2-retrieve-key';
      const value = { price: 200 };
      const entry = {
        value,
        timestamp: Date.now(),
        ttl: 60,
        source: 'test',
        version: 1,
      };

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(entry));

      const result = await cache.getL2<typeof value>(key);

      expect(result).not.toBeNull();
      expect(result?.value).toEqual(value);
    });

    it('should return null for expired L2 entries', async () => {
      const key = 'l2-expired-key';
      const entry = {
        value: { price: 300 },
        timestamp: Date.now() - 70000, // 70 seconds ago
        ttl: 60,
        source: 'test',
        version: 1,
      };

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(entry));

      const result = await cache.getL2(key);

      expect(result).toBeNull();
      expect(mockRedis.del).toHaveBeenCalledWith(`cache:l2:${key}`);
    });
  });

  describe('Cache-Aside Pattern', () => {
    it('should return cached value when available', async () => {
      const key = 'cached-key';
      const value = { data: 'cached' };

      // Pre-populate L1
      cache['setL1'](key, value, 60);

      const fetchFn = jest.fn().mockResolvedValue({ data: 'new' });

      const result = await cache.cacheAside(key, fetchFn, { ttlSeconds: 60 });

      expect(result.data).toEqual(value);
      expect(result.fromCache).toBe(true);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('should fetch and cache when value not available', async () => {
      const key = 'miss-key';
      const value = { data: 'fetched' };
      const fetchFn = jest.fn().mockResolvedValue(value);

      const result = await cache.cacheAside(key, fetchFn, { ttlSeconds: 60 });

      expect(result.data).toEqual(value);
      expect(result.fromCache).toBe(false);
      expect(fetchFn).toHaveBeenCalled();
    });

    it('should return stale data and refresh in background when staleWhileRevalidate is enabled', async () => {
      const key = 'stale-refresh-key';
      const oldValue = { data: 'old' };
      const newValue = { data: 'new' };

      // Pre-populate with stale value
      const l2Entry = {
        value: oldValue,
        timestamp: Date.now(),
        ttl: 60,
        source: 'test',
        version: 1,
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(l2Entry));

      const fetchFn = jest.fn().mockResolvedValue(newValue);

      const result = await cache.cacheAside(key, fetchFn, {
        ttlSeconds: 60,
        staleWhileRevalidate: true,
        staleTtlSeconds: 1,
      });

      expect(result.data).toEqual(oldValue);
      expect(result.fromCache).toBe(true);
      expect(result.stale).toBe(true);

      // Wait for background refresh
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should throw error when fetch fails and no cached data available', async () => {
      const key = 'error-key';
      const fetchFn = jest.fn().mockRejectedValue(new Error('Fetch failed'));

      await expect(
        cache.cacheAside(key, fetchFn, { ttlSeconds: 60 })
      ).rejects.toThrow('Fetch failed');
    });
  });

  describe('Write-Through Pattern', () => {
    it('should write to source then cache', async () => {
      const key = 'write-through-key';
      const value = { data: 'written' };
      const writeFn = jest.fn().mockResolvedValue(undefined);

      await cache.writeThrough(key, value, writeFn, { ttlSeconds: 60 });

      expect(writeFn).toHaveBeenCalledBefore(mockRedis.setex as jest.Mock);
    });
  });

  describe('Write-Behind Pattern', () => {
    it('should cache immediately and write asynchronously', async () => {
      const key = 'write-behind-key';
      const value = { data: 'cached-first' };
      const writeFn = jest.fn().mockResolvedValue(undefined);

      await cache.writeBehind(key, value, writeFn, { ttlSeconds: 60 });

      // Value should be cached immediately
      const l1Result = cache['getL1']<typeof value>(key);
      expect(l1Result?.entry.value).toEqual(value);

      // Wait for async write
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(writeFn).toHaveBeenCalled();
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate L1 and L2 cache for a key', async () => {
      const key = 'invalidate-key';
      const value = { data: 'to-invalidate' };

      cache['setL1'](key, value, 60);
      await cache.setL2(key, value, 60, 'test');

      await cache.invalidate(key);

      const l1Result = cache['getL1']<typeof value>(key);
      expect(l1Result).toBeNull();
      expect(mockRedis.del).toHaveBeenCalledWith(`cache:l2:${key}`);
    });

    it('should invalidate by pattern', async () => {
      cache['setL1']('asset:BTC:price', 50000, 60);
      cache['setL1']('asset:BTC:volume', 1000, 60);
      cache['setL1']('asset:ETH:price', 3000, 60);

      await cache.invalidatePattern('asset:BTC:.*');

      expect(cache['getL1']('asset:BTC:price')).toBeNull();
      expect(cache['getL1']('asset:BTC:volume')).toBeNull();
      expect(cache['getL1']('asset:ETH:price')).not.toBeNull();
    });

    it('should publish invalidation messages', async () => {
      const key = 'pub-invalidate-key';

      await cache.invalidate(key);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'cache:invalidate',
        JSON.stringify({ key })
      );
    });
  });

  describe('Cache Statistics', () => {
    it('should return accurate L1 cache stats', () => {
      // Add some entries
      for (let i = 0; i < 3; i++) {
        cache['setL1'](`stat-key-${i}`, `value-${i}`, 60);
      }

      const stats = cache.getStats();

      expect(stats.l1Size).toBe(3);
      expect(stats.l1MaxSize).toBe(5);
    });
  });
});
