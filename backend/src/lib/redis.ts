import Redis from 'ioredis';
import logger from '../utils/logger';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const isTest = process.env.NODE_ENV === 'test';

const createNoop = <T extends (...args: any[]) => any>(result?: ReturnType<T>) => {
  return (..._args: Parameters<T>) => result;
};

export const redis = isTest 
  ? ({
      duplicate: () => ({
        subscribe: createNoop<(channel: string, callback?: (err: Error | null) => void) => void>(undefined),
        on: createNoop<(event: string, handler: (...args: any[]) => void) => void>(undefined),
      }),
      call: (command: string, ...args: any[]) => {
        const cmd = command.toLowerCase();
        if (cmd === 'eval' || cmd === 'evalsha') {
          return [1, 60];
        }
        if (cmd === 'script' && args[0]?.toLowerCase() === 'load') {
          return 'mock-sha-1234567890';
        }
        return 1;
      },
      on: createNoop<(event: string, handler: (...args: any[]) => void) => void>(undefined),
      get: createNoop<(key: string) => Promise<string | null>>(null),
      set: createNoop<(key: string, value: string) => Promise<'OK'>>('OK'),
      del: createNoop<(key: string) => Promise<number>>(1),
      publish: createNoop<(channel: string, message: string) => Promise<number>>(1),
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

