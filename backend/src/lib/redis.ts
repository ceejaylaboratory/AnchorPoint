import Redis from 'ioredis';
import Redlock from 'redlock';
import logger from '../utils/logger';
import { RedisMonitor } from './redis-monitor';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const isTest = process.env.NODE_ENV === 'test';

const isSentinelEnabled = () => process.env.REDIS_SENTINEL_ENABLED === 'true';

const parseSentinels = (): Array<{ host: string; port: number }> => {
  const raw = process.env.REDIS_SENTINELS || '';
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [host, port] = entry.split(':');
      return { host: host || 'localhost', port: Number(port) || 26379 };
    });
};

const getSentinelName = () => process.env.REDIS_SENTINEL_NAME || 'mymaster';

export type RedisClientLike = {
  on: (event: string, handler: (...args: any[]) => void) => void;
  duplicate: (...args: unknown[]) => RedisClientLike;
  subscribe: (channel: string, callback?: (err: Error | null) => void) => void;
  publish: (channel: string, message: string) => Promise<number>;
  get?: (key: string) => Promise<string | null>;
  set?: (key: string, value: string, ...args: unknown[]) => Promise<unknown>;
  del?: (key: string) => Promise<number>;
  incr?: (key: string) => Promise<number>;
  expire?: (key: string, seconds: number) => Promise<number>;
  ping?: () => Promise<string>;
  call?: (command: string, ...args: unknown[]) => unknown;
  quit?: () => Promise<unknown>;
  disconnect?: () => Promise<unknown>;
};

export type RedisTestClient = RedisClientLike & {
  subscribe: (channel: string, callback?: (err: Error | null) => void) => void;
  call: (command: string, ...args: unknown[]) => number | string | [number, number];
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<'OK'>;
  del: (key: string) => Promise<number>;
  publish: (channel: string, message: string) => Promise<number>;
  ping: () => Promise<string>;
};

const attachRedisEventHandlers = <T extends RedisClientLike>(client: T) => {
  if (!isTest) {
    client.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    client.on('ready', () => {
      logger.info('Redis client ready');
    });

    client.on('error', (err: unknown) => {
      logger.error('Redis connection error:', err instanceof Error ? err : new Error(String(err)));
    });

    client.on('close', () => {
      logger.warn('Redis connection closed');
    });

    client.on('reconnecting', (delay: unknown) => {
      logger.warn(`Redis reconnecting in ${typeof delay === 'number' ? delay : 0}ms`);
    });

    // Handle end event to prevent unhandled error events
    client.on('end', () => {
      logger.warn('Redis connection ended');
    });
  }

  return client;
};

const decorateDuplicateMethod = <T extends RedisClientLike>(client: T): T => {
  const originalDuplicate = client.duplicate.bind(client);

  client.duplicate = ((...args: unknown[]) => {
    return decorateDuplicateMethod(attachRedisEventHandlers(originalDuplicate(...args) as T));
  }) as T['duplicate'];

  return client;
};

const createRedisClient = () => {
  const options = {
    maxRetriesPerRequest: 3,
    // Exponential backoff retry strategy with max attempts
    retryStrategy: (times: number) => {
      if (times > 10) {
        logger.error('Redis max reconnection attempts reached');
        return null; // Stop retrying
      }
      const delay = Math.min(50 * Math.pow(2, times), 30000); // Exponential: 50ms, 100ms, 200ms... up to 30s
      return delay;
    },
    // Socket configuration for timeout handling
    connectTimeout: 10000,
    commandTimeout: 5000,
    // Enable automatic reconnection
    lazyConnect: false,
    // Keep alive for persistent connections
    keepAlive: 30000,
  };

  const client = (
    isSentinelEnabled()
      ? new Redis({
          ...options,
          sentinels: parseSentinels(),
          name: getSentinelName(),
        })
      : new Redis(redisUrl, options)
  ) as unknown as RedisClientLike;

  return decorateDuplicateMethod(attachRedisEventHandlers(client));
};

const createTestRedisClient = (): RedisTestClient => ({
  duplicate: () => createTestRedisClient(),
  subscribe: () => undefined,
  on: () => undefined,
  call: (command: string, ...args: unknown[]) => {
    const cmd = command.toLowerCase();
    if (cmd === 'eval' || cmd === 'evalsha') {
      return [1, 60];
    }
    if (cmd === 'script' && typeof args[0] === 'string' && args[0].toLowerCase() === 'load') {
      return 'mock-sha-1234567890';
    }
    return 1;
  },
  get: async () => null,
  set: async () => 'OK',
  del: async () => 1,
  publish: async () => 1,
  ping: async () => 'PONG',
});

export const redis: Redis = (
  isTest ? createTestRedisClient() : createRedisClient()
) as unknown as Redis;

export const redlock = new Redlock(
  [redis as unknown as Redis],
  {
    driftFactor: 0.01,
    retryCount: 3,
    retryDelay: 200,
    retryJitter: 200,
    automaticExtensionThreshold: 500, // time in ms before lock expiration to automatically extend it
  }
);

let redisMonitor: RedisMonitor | null = null;

export const startRedisMonitor = (): RedisMonitor | null => {
  if (isTest) {
    return null;
  }

  if (redisMonitor) {
    return redisMonitor;
  }

  const monitorClient = (redis as unknown as RedisClientLike).duplicate() as unknown as Redis;
  redisMonitor = new RedisMonitor(monitorClient, {
    sentinelName: getSentinelName(),
    sentinels: isSentinelEnabled() ? parseSentinels() : undefined,
  });
  redisMonitor.start();
  return redisMonitor;
};

export const stopRedisMonitor = async (): Promise<void> => {
  if (!redisMonitor) {
    return;
  }

  const monitor = redisMonitor;
  redisMonitor = null;
  await monitor.stop();
};
