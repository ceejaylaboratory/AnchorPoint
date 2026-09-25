import { Sep38QuoteCacheService, Sep38QuoteCacheCleanupWorker } from './sep38-quote-cache.service';

// Mock Redis
const createMockRedis = () => {
  const data = new Map<string, string>();
  const zset = new Map<string, number>();

  return {
    setex: jest.fn(async (key: string, _seconds: number, value: string) => {
      data.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => data.get(key) ?? null),
    del: jest.fn(async (key: string) => (data.delete(key) ? 1 : 0)),
    zadd: jest.fn(async (_index: string, score: number, member: string) => {
      zset.set(member, score);
      return 1;
    }),
    zrem: jest.fn(async (_index: string, ...members: string[]) => {
      let count = 0;
      members.forEach((m) => {
        if (zset.delete(m)) count++;
      });
      return count;
    }),
    zrangebyscore: jest.fn(async (_index: string, min: number, max: number) => {
      return Array.from(zset.entries())
        .filter(([, score]) => score >= min && score <= max)
        .map(([member]) => member);
    }),
    _data: data,
    _zset: zset,
  };
};

describe('Sep38QuoteCacheService', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let service: Sep38QuoteCacheService;

  beforeEach(() => {
    mockRedis = createMockRedis();
    service = new Sep38QuoteCacheService(mockRedis as any);
  });

  describe('cacheQuote / getQuote', () => {
    it('stores a quote and retrieves it back', async () => {
      const payload = { id: 'q1', sellAsset: 'USDC', buyAsset: 'XLM' };

      await service.cacheQuote('q1', payload, 60);
      const result = await service.getQuote('q1');

      expect(result).toEqual(payload);
      expect(mockRedis.setex).toHaveBeenCalledWith('sep38:quote:q1', 60, JSON.stringify(payload));
    });

    it('records the quote id in the expiry index with the correct score', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      await service.cacheQuote('q2', { id: 'q2' }, 30);

      expect(mockRedis.zadd).toHaveBeenCalledWith('sep38:quote:index', now + 30_000, 'q2');

      jest.spyOn(Date, 'now').mockRestore();
    });

    it('does not cache a quote with a non-positive TTL', async () => {
      await service.cacheQuote('q3', { id: 'q3' }, 0);

      expect(mockRedis.setex).not.toHaveBeenCalled();
      expect(mockRedis.zadd).not.toHaveBeenCalled();
    });

    it('returns null for a quote that was never cached', async () => {
      const result = await service.getQuote('missing');
      expect(result).toBeNull();
    });

    it('returns null and does not throw if the cached payload is malformed JSON', async () => {
      mockRedis._data.set('sep38:quote:bad', 'not-json{');
      const result = await service.getQuote('bad');
      expect(result).toBeNull();
    });
  });

  describe('invalidateQuote', () => {
    it('removes the quote key and its index entry', async () => {
      await service.cacheQuote('q4', { id: 'q4' }, 60);
      await service.invalidateQuote('q4');

      expect(await service.getQuote('q4')).toBeNull();
      expect(mockRedis.zrem).toHaveBeenCalledWith('sep38:quote:index', 'q4');
    });
  });

  describe('cleanupExpiredQuotes (expiration)', () => {
    it('purges only index entries whose expiry has passed', async () => {
      const now = Date.now();
      // Seed the index directly to control exact expiry timestamps.
      mockRedis._zset.set('expired-1', now - 5000);
      mockRedis._zset.set('expired-2', now - 1000);
      mockRedis._zset.set('still-valid', now + 60_000);

      const purged = await service.cleanupExpiredQuotes(now);

      expect(purged).toBe(2);
      expect(mockRedis._zset.has('expired-1')).toBe(false);
      expect(mockRedis._zset.has('expired-2')).toBe(false);
      expect(mockRedis._zset.has('still-valid')).toBe(true);
    });

    it('returns 0 when nothing has expired', async () => {
      mockRedis._zset.set('still-valid', Date.now() + 60_000);
      const purged = await service.cleanupExpiredQuotes();
      expect(purged).toBe(0);
    });
  });
});

describe('Sep38QuoteCacheCleanupWorker', () => {
  it('starts and stops without throwing', () => {
    const mockRedis = createMockRedis();
    const service = new Sep38QuoteCacheService(mockRedis as any);
    const worker = new Sep38QuoteCacheCleanupWorker(service);

    expect(() => worker.start()).not.toThrow();
    expect(() => worker.stop()).not.toThrow();
  });
});
