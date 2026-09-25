import { Request, Response, NextFunction } from 'express';
import {
  submissionLimiterOptions,
  TIER_LIMITS,
  TIER_AUTH_LIMITS,
  TIER_SENSITIVE_LIMITS,
  RedisWithMemoryFallbackStore,
} from './rate-limit.middleware';
import * as StellarSdk from '@stellar/stellar-sdk';

jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...original,
    TransactionBuilder: {
      fromXDR: jest.fn(),
    },
  };
});

jest.mock('rate-limit-redis', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    increment: jest.fn().mockResolvedValue({ totalHits: 1, resetTime: new Date() }),
    decrement: jest.fn(),
    resetKey: jest.fn(),
  }));
});

jest.mock('../../lib/redis', () => ({
  redis: {
    call: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
}));

describe('Rate Limit Middleware', () => {
  describe('submissionLimiter keyGenerator', () => {
    let mockReq: Partial<Request>;

    beforeEach(() => {
      mockReq = {
        body: {},
        ip: '127.0.0.1',
      };
      jest.clearAllMocks();
    });

    it('should use source account from valid XDR', () => {
      const xdr = 'valid-xdr';
      mockReq.body = { xdr };
      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue({ source: 'G_SOURCE' });

      const key = submissionLimiterOptions.keyGenerator(mockReq as Request);
      expect(key).toBe('G_SOURCE');
      expect(StellarSdk.TransactionBuilder.fromXDR).toHaveBeenCalled();
    });

    it('should handle FeeBumpTransaction source account', () => {
      const xdr = 'feebump-xdr';
      mockReq.body = { xdr };
      const mockFeeBump = Object.create(StellarSdk.FeeBumpTransaction.prototype);
      Object.defineProperty(mockFeeBump, 'innerTransaction', { value: { source: 'G_INNER' } });


      
      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockReturnValue(mockFeeBump);

      const key = submissionLimiterOptions.keyGenerator(mockReq as Request);
      expect(key).toBe('G_INNER');
    });

    it('should fallback to IP if XDR is missing', () => {
      const key = submissionLimiterOptions.keyGenerator(mockReq as Request);
      expect(key).toBe('127.0.0.1');
    });

    it('should fallback to IP if XDR parsing fails', () => {
      mockReq.body = { xdr: 'invalid' };
      (StellarSdk.TransactionBuilder.fromXDR as jest.Mock).mockImplementation(() => {
        throw new Error('invalid');
      });

      const key = submissionLimiterOptions.keyGenerator(mockReq as Request);

      expect(key).toBe('127.0.0.1');
    });

    it('should fallback to unknown if IP is missing', () => {
      (mockReq as any).ip = undefined;
      const key = submissionLimiterOptions.keyGenerator(mockReq as Request);

      expect(key).toBe('unknown');
    });
  });

  describe('createRateLimiter', () => {
    it('should create a limiter with default options', () => {
      const { createRateLimiter } = require('./rate-limit.middleware');
      const limiter = createRateLimiter();
      expect(limiter).toBeDefined();
    });
  });

  describe('publicLimiter', () => {
    it('should export a shared public Redis-backed limiter', () => {
      const { publicLimiter } = require('./rate-limit.middleware');
      expect(publicLimiter).toBeDefined();
    });
  });

  describe('TIER_LIMITS', () => {
    it('should define limits for Free tier: 60 req/min', () => {
      expect(TIER_LIMITS.Free).toEqual({ windowMs: 60000, max: 60 });
    });

    it('should define limits for Pro tier: 600 req/min', () => {
      expect(TIER_LIMITS.Pro).toEqual({ windowMs: 60000, max: 600 });
    });

    it('should define limits for Enterprise tier: 3000 req/min', () => {
      expect(TIER_LIMITS.Enterprise).toEqual({ windowMs: 60000, max: 3000 });
    });
  });

  describe('TIER_AUTH_LIMITS', () => {
    it('should define auth limits for Free tier: 10 req/10min', () => {
      expect(TIER_AUTH_LIMITS.Free).toEqual({ windowMs: 600000, max: 10 });
    });

    it('should define auth limits for Pro tier: 50 req/10min', () => {
      expect(TIER_AUTH_LIMITS.Pro).toEqual({ windowMs: 600000, max: 50 });
    });

    it('should define auth limits for Enterprise tier: 200 req/10min', () => {
      expect(TIER_AUTH_LIMITS.Enterprise).toEqual({ windowMs: 600000, max: 200 });
    });
  });

  describe('TIER_SENSITIVE_LIMITS', () => {
    it('should define sensitive limits for Free tier: 5 req/min', () => {
      expect(TIER_SENSITIVE_LIMITS.Free).toEqual({ windowMs: 60000, max: 5 });
    });

    it('should define sensitive limits for Pro tier: 20 req/min', () => {
      expect(TIER_SENSITIVE_LIMITS.Pro).toEqual({ windowMs: 60000, max: 20 });
    });

    it('should define sensitive limits for Enterprise tier: 100 req/min', () => {
      expect(TIER_SENSITIVE_LIMITS.Enterprise).toEqual({ windowMs: 60000, max: 100 });
    });
  });

  describe('tieredApiLimiter', () => {
    it('should export a tiered API limiter', () => {
      const { tieredApiLimiter } = require('./rate-limit.middleware');
      expect(tieredApiLimiter).toBeDefined();
    });
  });

  describe('tieredAuthLimiter', () => {
    it('should export a tiered auth limiter', () => {
      const { tieredAuthLimiter } = require('./rate-limit.middleware');
      expect(tieredAuthLimiter).toBeDefined();
    });
  });

  describe('tieredSensitiveLimiter', () => {
    it('should export a tiered sensitive limiter', () => {
      const { tieredSensitiveLimiter } = require('./rate-limit.middleware');
      expect(tieredSensitiveLimiter).toBeDefined();
    });
  });

  describe('RedisWithMemoryFallbackStore', () => {
    function makeStores() {
      const redisStore = {
        init: jest.fn(),
        increment: jest.fn(),
        decrement: jest.fn(),
        resetKey: jest.fn(),
      };
      const memoryStore = {
        init: jest.fn(),
        increment: jest.fn(),
        decrement: jest.fn(),
        resetKey: jest.fn(),
      };
      return { redisStore, memoryStore };
    }

    it('delegates increment to the Redis store when it succeeds', async () => {
      const { redisStore, memoryStore } = makeStores();
      redisStore.increment.mockResolvedValue({ totalHits: 5, resetTime: undefined });
      const store = new RedisWithMemoryFallbackStore(redisStore as any, memoryStore as any);

      const result = await store.increment('key1');

      expect(result).toEqual({ totalHits: 5, resetTime: undefined });
      expect(memoryStore.increment).not.toHaveBeenCalled();
    });

    it('falls back to the in-memory store when Redis throws on increment', async () => {
      const { redisStore, memoryStore } = makeStores();
      redisStore.increment.mockRejectedValue(new Error('connection refused'));
      memoryStore.increment.mockResolvedValue({ totalHits: 1, resetTime: undefined });
      const store = new RedisWithMemoryFallbackStore(redisStore as any, memoryStore as any);

      const result = await store.increment('key1');

      expect(result).toEqual({ totalHits: 1, resetTime: undefined });
      expect(memoryStore.increment).toHaveBeenCalledWith('key1');
    });

    it('falls back to the in-memory store when Redis throws on decrement', async () => {
      const { redisStore, memoryStore } = makeStores();
      redisStore.decrement.mockRejectedValue(new Error('connection refused'));
      const store = new RedisWithMemoryFallbackStore(redisStore as any, memoryStore as any);

      await store.decrement('key1');

      expect(memoryStore.decrement).toHaveBeenCalledWith('key1');
    });

    it('falls back to the in-memory store when Redis throws on resetKey', async () => {
      const { redisStore, memoryStore } = makeStores();
      redisStore.resetKey.mockRejectedValue(new Error('connection refused'));
      const store = new RedisWithMemoryFallbackStore(redisStore as any, memoryStore as any);

      await store.resetKey('key1');

      expect(memoryStore.resetKey).toHaveBeenCalledWith('key1');
    });

    it('initializes both the Redis and memory stores', () => {
      const { redisStore, memoryStore } = makeStores();
      const store = new RedisWithMemoryFallbackStore(redisStore as any, memoryStore as any);
      const options = {} as any;

      store.init(options);

      expect(redisStore.init).toHaveBeenCalledWith(options);
      expect(memoryStore.init).toHaveBeenCalledWith(options);
    });
  });
});


