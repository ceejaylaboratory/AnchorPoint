import { Sep1InfoCacheService } from './sep1-info-cache.service';

// Minimal fake Redis client used across all tests
function makeRedis(overrides: Partial<ReturnType<typeof makeFakeRedis>> = {}) {
  return makeFakeRedis(overrides);
}

function makeFakeRedis(overrides: Partial<{
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  expire: jest.Mock;
}> = {}) {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ...overrides,
  };
}

type InfoPayload = { version: string; network: string };

function makePayload(network = 'testnet'): InfoPayload {
  return { version: '1.0.0', network };
}

describe('Sep1InfoCacheService', () => {
  let redis: ReturnType<typeof makeFakeRedis>;
  let cache: Sep1InfoCacheService<InfoPayload>;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = makeRedis();
    cache = new Sep1InfoCacheService<InfoPayload>(redis as any);
  });

  // ── getOrCompute ────────────────────────────────────────────────────────────

  describe('getOrCompute', () => {
    it('calls computeFn and caches the result on a cold miss', async () => {
      const compute = jest.fn().mockReturnValue(makePayload());

      const result = await cache.getOrCompute(compute);

      expect(compute).toHaveBeenCalledTimes(1);
      expect(result.network).toBe('testnet');
      // Should have written to Redis
      expect(redis.set).toHaveBeenCalled();
    });

    it('returns the cached value without calling computeFn on a fresh hit', async () => {
      const entry = { value: makePayload('mainnet'), cachedAt: Date.now() };
      redis.get.mockResolvedValue(JSON.stringify(entry));

      const compute = jest.fn().mockReturnValue(makePayload());

      const result = await cache.getOrCompute(compute);

      expect(compute).not.toHaveBeenCalled();
      expect(result.network).toBe('mainnet');
    });

    it('serves stale entry and schedules a background refresh', async () => {
      // cachedAt is just past TTL but within grace window
      const pastTtl = Date.now() - (Sep1InfoCacheService.ttlSeconds + 30) * 1000;
      const entry = { value: makePayload('stale-net'), cachedAt: pastTtl };
      redis.get.mockResolvedValue(JSON.stringify(entry));

      const compute = jest.fn().mockReturnValue(makePayload('fresh-net'));

      const result = await cache.getOrCompute(compute);

      // Stale value returned immediately
      expect(result.network).toBe('stale-net');
      // computeFn is NOT called synchronously
      expect(compute).not.toHaveBeenCalled();
    });

    it('recomputes when the entry is fully expired (past TTL + grace)', async () => {
      const fullyExpired = Date.now() -
        (Sep1InfoCacheService.ttlSeconds + Sep1InfoCacheService.staleGraceSeconds + 10) * 1000;
      const entry = { value: makePayload('expired-net'), cachedAt: fullyExpired };
      redis.get.mockResolvedValue(JSON.stringify(entry));

      const compute = jest.fn().mockReturnValue(makePayload('new-net'));

      const result = await cache.getOrCompute(compute);

      expect(compute).toHaveBeenCalledTimes(1);
      expect(result.network).toBe('new-net');
    });

    it('falls back to computeFn when Redis throws', async () => {
      redis.get.mockRejectedValue(new Error('Redis connection refused'));
      const compute = jest.fn().mockReturnValue(makePayload('fallback-net'));

      const result = await cache.getOrCompute(compute);

      expect(compute).toHaveBeenCalledTimes(1);
      expect(result.network).toBe('fallback-net');
    });

    it('does not throw when Redis write fails after a cache miss', async () => {
      redis.set.mockRejectedValue(new Error('Redis write error'));
      const compute = jest.fn().mockReturnValue(makePayload());

      await expect(cache.getOrCompute(compute)).resolves.not.toThrow();
    });
  });

  // ── get ─────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns null on a cold cache', async () => {
      expect(await cache.get()).toBeNull();
    });

    it('returns the value when entry is within TTL', async () => {
      const entry = { value: makePayload(), cachedAt: Date.now() };
      redis.get.mockResolvedValue(JSON.stringify(entry));
      expect(await cache.get()).not.toBeNull();
    });

    it('returns null when entry is fully expired past grace window', async () => {
      const fullyExpired = Date.now() -
        (Sep1InfoCacheService.ttlSeconds + Sep1InfoCacheService.staleGraceSeconds + 5) * 1000;
      const entry = { value: makePayload(), cachedAt: fullyExpired };
      redis.get.mockResolvedValue(JSON.stringify(entry));
      expect(await cache.get()).toBeNull();
    });

    it('returns null when Redis throws', async () => {
      redis.get.mockRejectedValue(new Error('Redis down'));
      expect(await cache.get()).toBeNull();
    });
  });

  // ── isStale ─────────────────────────────────────────────────────────────────

  describe('isStale', () => {
    it('returns false on a cold cache', async () => {
      expect(await cache.isStale()).toBe(false);
    });

    it('returns false when entry is still fresh', async () => {
      const entry = { value: makePayload(), cachedAt: Date.now() };
      redis.get.mockResolvedValue(JSON.stringify(entry));
      expect(await cache.isStale()).toBe(false);
    });

    it('returns true when entry is past TTL but within grace window', async () => {
      const pastTtl = Date.now() - (Sep1InfoCacheService.ttlSeconds + 10) * 1000;
      const entry = { value: makePayload(), cachedAt: pastTtl };
      redis.get.mockResolvedValue(JSON.stringify(entry));
      expect(await cache.isStale()).toBe(true);
    });

    it('returns false when entry is fully expired past grace window', async () => {
      const fullyExpired = Date.now() -
        (Sep1InfoCacheService.ttlSeconds + Sep1InfoCacheService.staleGraceSeconds + 5) * 1000;
      const entry = { value: makePayload(), cachedAt: fullyExpired };
      redis.get.mockResolvedValue(JSON.stringify(entry));
      expect(await cache.isStale()).toBe(false);
    });
  });

  // ── set ─────────────────────────────────────────────────────────────────────

  describe('set', () => {
    it('writes a CacheEntry to Redis with an extended TTL', async () => {
      await cache.set(makePayload());

      expect(redis.set).toHaveBeenCalledWith(
        Sep1InfoCacheService.cacheKey,
        expect.stringContaining('"version":"1.0.0"')
      );
      expect(redis.expire).toHaveBeenCalledWith(
        Sep1InfoCacheService.cacheKey,
        Sep1InfoCacheService.ttlSeconds + Sep1InfoCacheService.staleGraceSeconds
      );
    });

    it('does not throw when Redis write fails', async () => {
      redis.set.mockRejectedValue(new Error('disk full'));
      await expect(cache.set(makePayload())).resolves.toBeUndefined();
    });
  });

  // ── invalidate ───────────────────────────────────────────────────────────────

  describe('invalidate', () => {
    it('deletes the cache key', async () => {
      await cache.invalidate();
      expect(redis.del).toHaveBeenCalledWith(Sep1InfoCacheService.cacheKey);
    });

    it('does not throw when Redis delete fails', async () => {
      redis.del.mockRejectedValue(new Error('Redis down'));
      await expect(cache.invalidate()).resolves.toBeUndefined();
    });
  });
});