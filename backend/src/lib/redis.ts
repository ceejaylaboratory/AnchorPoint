import Redis from 'ioredis';
import logger from '../utils/logger';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const isTest = process.env.NODE_ENV === 'test';

export const redis = isTest 
  ? ({
      call: jest.fn().mockImplementation((command: string, ...args: any[]) => {
        const cmd = command.toLowerCase();
        if (cmd === 'eval' || cmd === 'evalsha') {
          return [1, 60];
        }
        if (cmd === 'script' && args[0]?.toLowerCase() === 'load') {
          return 'mock-sha-1234567890';
        }
        return 1;
      }),
      on: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as any)



  : new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

if (!isTest) {
  redis.on('connect', () => {
    logger.info('Redis connected successfully');
  });

  redis.on('error', (err: Error) => {
    logger.error('Redis connection error:', err);
  });
}

