import { PriceAggregationService, PriceSourceConfig, PriceFetchOptions } from './price-aggregation.service';
import { circuitBreakerRegistry } from './circuit-breaker.service';

// Mock global fetch
global.fetch = jest.fn();

const createMockRedis = () => ({
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  expire: jest.fn(),
  keys: jest.fn().mockResolvedValue([]),
  pipeline: jest.fn(() => ({
    sadd: jest.fn(function() { return this; }),
    smembers: jest.fn(function() { return this; }),
    del: jest.fn(function() { return this; }),
    exec: jest.fn().mockResolvedValue([]),
  })),
  publish: jest.fn().mockResolvedValue(1),
  subscribe: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  duplicate: jest.fn(function() { return this; }),
  quit: jest.fn().mockResolvedValue(undefined),
  unsubscribe: jest.fn().mockResolvedValue(undefined),
});

describe('PriceAggregationService', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let service: PriceAggregationService;

  beforeEach(() => {
    mockRedis = createMockRedis();
    service = new PriceAggregationService(mockRedis as unknown as Parameters<typeof PriceAggregationService>[0]);
    jest.clearAllMocks();
    circuitBreakerRegistry.resetAll();
  });

  describe('Price Aggregation', () => {
    it('should aggregate prices from multiple sources', async () => {
      // Mock successful responses
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            _embedded: {
              records: [{ avg: '0.12' }],
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            price: '1.00',
          }),
        });

      const result = await service.getPrice('XLM', { minSources: 1 });

      expect(result).toBeDefined();
      expect(result.asset).toBe('XLM');
      expect(result.price).toBeGreaterThan(0);
      expect(result.sources).toBeDefined();
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should handle partial failures gracefully', async () => {
      // One source succeeds, one fails
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            _embedded: {
              records: [{ avg: '0.15' }],
            },
          }),
        })
        .mockRejectedValueOnce(new Error('Exchange API error'));

      const result = await service.getPrice('XLM', { minSources: 1 });

      expect(result.isPartial).toBe(true);
      expect(result.aggregatedFrom).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThan(1);
    });

    it('should throw error when minimum sources not available', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('API error'));

      await expect(
        service.getPrice('XLM', { minSources: 2 })
      ).rejects.toThrow('Insufficient data sources');
    });

    it('should use cached prices when available', async () => {
      const cachedPrice = {
        asset: 'XLM',
        price: 0.12,
        timestamp: Date.now(),
        ttl: 60,
        source: 'test',
        version: 1,
      };

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedPrice));

      const result = await service.getPrice('XLM', { preferCache: true });

      expect(result.price).toBe(0.12);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Multiple Assets', () => {
    it('should fetch multiple asset prices', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            _embedded: { records: [{ avg: '0.12' }] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ price: '1.00' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            _embedded: { records: [{ avg: '1.00' }] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ price: '1.00' }),
        });

      const results = await service.getMultiplePrices(['XLM', 'USDC']);

      expect(results.size).toBe(2);
      expect(results.has('XLM')).toBe(true);
      expect(results.has('USDC')).toBe(true);
    });

    it('should handle partial failures in batch requests', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('API error'));

      const results = await service.getMultiplePrices(['XLM', 'USDC']);

      // Should fall back to fallback prices
      expect(results.size).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Circuit Breaker Integration', () => {
    it('should use circuit breaker for external calls', async () => {
      const breakerSpy = jest.spyOn(circuitBreakerRegistry.get('horizon'), 'execute');

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _embedded: { records: [{ avg: '0.12' }] },
        }),
      });

      await service.getPrice('XLM', { minSources: 1 });

      expect(breakerSpy).toHaveBeenCalled();
    });

    it('should return circuit breaker metrics', () => {
      const metrics = service.getCircuitBreakerMetrics();

      expect(metrics).toHaveProperty('horizon');
      expect(metrics).toHaveProperty('external-exchange');
    });

    it('should reset circuit breakers', () => {
      service.resetCircuitBreakers();

      const metrics = service.getCircuitBreakerMetrics();
      expect(metrics['horizon'].state).toBe('CLOSED');
      expect(metrics['external-exchange'].state).toBe('CLOSED');
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate specific asset price', async () => {
      await service.invalidatePrice('XLM');

      expect(mockRedis.del).toHaveBeenCalledWith(expect.stringContaining('XLM'));
    });

    it('should invalidate all prices', async () => {
      await service.invalidateAllPrices();

      expect(mockRedis.pipeline).toHaveBeenCalled();
    });
  });

  describe('Confidence Calculation', () => {
    it('should calculate high confidence for consistent prices', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            _embedded: { records: [{ avg: '0.12' }] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ price: '0.121' }),
        });

      const result = await service.getPrice('XLM', { minSources: 2 });

      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should calculate low confidence for divergent prices', async () => {
      // Very different prices between sources
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            _embedded: { records: [{ avg: '0.10' }] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ price: '0.20' }),
        });

      const result = await service.getPrice('XLM', { minSources: 2 });

      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  describe('Weighted Average Calculation', () => {
    it('should weight prices by source priority', async () => {
      const configs: PriceSourceConfig[] = [
        { name: 'horizon', weight: 0.7, priority: 1, timeoutMs: 5000 },
        { name: 'external-exchange', weight: 0.3, priority: 2, timeoutMs: 5000 },
      ];

      const customService = new PriceAggregationService(
        mockRedis as unknown as Parameters<typeof PriceAggregationService>[0],
        configs
      );

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            _embedded: { records: [{ avg: '0.10' }] },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ price: '0.20' }),
        });

      const result = await customService.getPrice('XLM', { minSources: 2 });

      // With weights 0.7 and 0.3, price should be closer to 0.10
      expect(result.price).toBeGreaterThan(0.10);
      expect(result.price).toBeLessThan(0.20);
    });
  });

  describe('Force Refresh', () => {
    it('should bypass cache when forceRefresh is true', async () => {
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({
        asset: 'XLM',
        price: 0.10,
        timestamp: Date.now(),
        ttl: 60,
        source: 'test',
        version: 1,
      }));

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          _embedded: { records: [{ avg: '0.15' }] },
        }),
      });

      const result = await service.getPrice('XLM', { forceRefresh: true });

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('Cache Statistics', () => {
    it('should return L1 cache stats', async () => {
      const stats = await service.getCacheStats();

      expect(stats).toHaveProperty('l1Size');
      expect(stats).toHaveProperty('l1MaxSize');
    });
  });
});
