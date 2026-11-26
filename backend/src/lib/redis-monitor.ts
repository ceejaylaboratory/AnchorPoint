import { EventEmitter } from 'events';
import type { Redis, RedisOptions } from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';
import { metrics } from './metrics';

/**
 * Sentinel event names we care about.
 */
export type SentinelEvent =
  | '+switch-master'
  | '+reboot'
  | '+sdown';

export interface SentinelEventPayload {
  event: SentinelEvent;
  /** Raw payload string from Sentinel pub/sub. */
  raw: string;
  /** Old master address (host:port) if applicable. */
  oldMaster?: string;
  /** New master address (host:port) if applicable. */
  newMaster?: string;
  /** Master name from Sentinel config. */
  masterName?: string;
  /** Failover duration in milliseconds, if derivable. */
  durationMs?: number;
  /** Timestamp when the event was observed. */
  timestamp: number;
}

export interface RedisMonitorOptions {
  /**
   * A dedicated (duplicated) Redis client used to subscribe to Sentinel
   * pub/sub channels. Must be a Sentinel-capable connection.
   */
  client: Redis;
  /**
   * Optional metrics service. Defaults to the shared `metrics` instance.
   */
  metricsService?: Pick<typeof metrics, 'incrementCounter' | 'setGauge'>;
  /**
   * Optional logger. Defaults to the shared `logger`.
   */
  loggerService?: Pick<typeof logger, 'info' | 'warn' | 'error'>;
  /**
   * Master name to filter events for. Defaults to env value.
   */
  masterName?: string;
}

const SENTINEL_CHANNELS: SentinelEvent[] = ['+switch-master', '+reboot', '+sdown'];

/**
 * Parses a Sentinel pub/sub payload into a structured event.
 *
 * Sentinel payload formats:
 *  - `+switch-master`: `<master-name> <old-ip> <old-port> <new-ip> <new-port>`
 *  - `+reboot`:        `<master-name> <ip> <port>`
 *  - `+sdown`:         `<master-name> <ip> <port>`
 */
export function parseSentinelPayload(
  event: SentinelEvent,
  raw: string,
  timestamp: number = Date.now(),
): SentinelEventPayload {
  const parts = raw.trim().split(/\s+/);
  const payload: SentinelEventPayload = { event, raw, timestamp };

  if (event === '+switch-master') {
    const [masterName, oldIp, oldPort, newIp, newPort] = parts;
    payload.masterName = masterName;
    if (oldIp && oldPort) {
      payload.oldMaster = `${oldIp}:${oldPort}`;
    }
    if (newIp && newPort) {
      payload.newMaster = `${newIp}:${newPort}`;
    }
  } else {
    const [masterName, ip, port] = parts;
    payload.masterName = masterName;
    if (ip && port) {
      payload.oldMaster = `${ip}:${port}`;
    }
  }

  return payload;
}

/**
 * RedisMonitor subscribes to Sentinel pub/sub channels and reports
 * failover events via metrics and structured logs.
 */
export class RedisMonitor extends EventEmitter {
  private readonly client: Redis;
  private readonly metricsService: Pick<typeof metrics, 'incrementCounter' | 'setGauge'>;
  private readonly loggerService: Pick<typeof logger, 'info' | 'warn' | 'error'>;
  private readonly masterName?: string;
  private started = false;
  private readonly messageHandler: (channel: string, message: string) => void;
  private readonly errorHandler: (err: Error) => void;

  constructor(options: RedisMonitorOptions) {
    super();
    this.client = options.client;
    this.metricsService = options.metricsService ?? metrics;
    this.loggerService = options.loggerService ?? logger;
    this.masterName = options.masterName ?? env.REDIS_SENTINEL_MASTER_NAME;

    this.messageHandler = (channel: string, message: string) => {
      this.handleMessage(channel, message);
    };
    this.errorHandler = (err: Error) => {
      this.loggerService.error('Redis monitor subscription error', {
        error: err.message,
      });
    };
  }

  /**
   * Returns true when Sentinel monitoring is enabled via env config.
   */
  static isEnabled(): boolean {
    return Boolean(env.REDIS_SENTINEL_ENABLED) && Boolean(env.REDIS_SENTINELS);
  }

  /**
   * Starts listening for Sentinel events. Idempotent.
   */
  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    this.client.on('message', this.messageHandler);
    this.client.on('error', this.errorHandler);

    try {
      await this.client.subscribe(...SENTINEL_CHANNELS);
      this.loggerService.info('Redis Sentinel monitor started', {
        channels: SENTINEL_CHANNELS,
        masterName: this.masterName,
      });
    } catch (err) {
      this.started = false;
      this.client.removeListener('message', this.messageHandler);
      this.client.removeListener('error', this.errorHandler);
      this.loggerService.error('Failed to subscribe to Sentinel channels', {
        error: (err as Error).message,
      });
      throw err;
    }
  }

  /**
   * Stops listening for Sentinel events. Idempotent.
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;

    this.client.removeListener('message', this.messageHandler);
    this.client.removeListener('error', this.errorHandler);

    try {
      await this.client.unsubscribe(...SENTINEL_CHANNELS);
    } catch (err) {
      this.loggerService.warn('Failed to unsubscribe from Sentinel channels', {
        error: (err as Error).message,
      });
    }

    this.loggerService.info('Redis Sentinel monitor stopped');
  }

  /**
   * Reports the current number of connected clients as a gauge.
   * Safe to call periodically.
   */
  async reportConnectedClients(): Promise<void> {
    try {
      const info = await this.client.info('clients');
      const match = /connected_clients:(\d+)/.exec(info);
      if (match) {
        const connected = Number.parseInt(match[1], 10);
        this.metricsService.setGauge('redis_connected_clients', connected);
      }
    } catch (err) {
      this.loggerService.warn('Failed to read connected clients from Redis', {
        error: (err as Error).message,
      });
    }
  }

  private handleMessage(channel: string, message: string): void {
    if (!SENTINEL_CHANNELS.includes(channel as SentinelEvent)) {
      return;
    }

    const event = channel as SentinelEvent;
    const payload = parseSentinelPayload(event, message);

    // Filter by master name when configured.
    if (this.masterName && payload.masterName && payload.masterName !== this.masterName) {
      return;
    }

    this.metricsService.incrementCounter('redis_failover_events_total', {
      event,
      old_master: payload.oldMaster ?? '',
      new_master: payload.newMaster ?? '',
    });

    if (event === '+switch-master') {
      this.loggerService.info('Redis master failover detected', {
        event,
        masterName: payload.masterName,
        oldMaster: payload.oldMaster,
        newMaster: payload.newMaster,
        durationMs: payload.durationMs,
      });
    } else if (event === '+sdown') {
      this.loggerService.warn('Redis master marked subjectively down', {
        event,
        masterName: payload.masterName,
        address: payload.oldMaster,
      });
    } else {
      this.loggerService.info('Redis Sentinel reboot event', {
        event,
        masterName: payload.masterName,
        address: payload.oldMaster,
      });
    }

    this.emit('event', payload);
    this.emit(event, payload);
  }
}

/**
 * Creates and starts a RedisMonitor using a duplicated Sentinel-capable client.
 * Returns `null` when Sentinel monitoring is not configured.
 */
export async function startRedisMonitor(
  createClient: () => Redis,
): Promise<RedisMonitor | null> {
  if (!RedisMonitor.isEnabled()) {
    return null;
  }

  const client = createClient();
  const monitor = new RedisMonitor({ client });

  try {
    await monitor.start();
  } catch (err) {
    logger.error('Unable to start Redis Sentinel monitor', {
      error: (err as Error).message,
    });
    return null;
  }

  return monitor;
}

export type { RedisOptions };
```

```typescript
// backend/src/lib/redis.ts
import Redis, { RedisOptions } from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';
import { RedisMonitor, startRedisMonitor } from './redis-monitor';

let redisClient: Redis | null = null;
let redisMonitor: RedisMonitor | null = null;

function buildRedisOptions(): RedisOptions {
  const options: RedisOptions = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times: number) => Math.min(times * 100, 3000),
  };

  if (env.REDIS_SENTINEL_ENABLED && env.REDIS_SENTINELS) {
    const sentinels = env.REDIS_SENTINELS.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [host, port] = entry.split(':');
        return { host, port: Number.parseInt(port ?? '26379', 10) };
      });

    options.sentinels = sentinels;
    options.name = env.REDIS_SENTINEL_MASTER_NAME;
  }

  return options;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(buildRedisOptions());

    redisClient.on('error', (err) => {
      logger.error('Redis client error', { error: err.message });
    });

    redisClient.on('reconnecting', () => {
      logger.warn('Redis client reconnecting');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
    });
  }

  return redisClient;
}

/**
 * Creates a duplicated Sentinel-capable client and starts the monitor.
 * Safe to call multiple times; only initializes once.
 */
export async function startRedisMonitorIfEnabled(): Promise<RedisMonitor | null> {
  if (redisMonitor) {
    return redisMonitor;
  }

  redisMonitor = await startRedisMonitor(() => getRedisClient().duplicate());
  return redisMonitor;
}

export async function stopRedisMonitor(): Promise<void> {
  if (redisMonitor) {
    await redisMonitor.stop();
    redisMonitor = null;
  }
}

export async function closeRedis(): Promise<void> {
  await stopRedisMonitor();
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
```

```typescript
// backend/src/config/env.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().default(0),

  REDIS_SENTINEL_ENABLED: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
  REDIS_SENTINELS: z.string().optional(),
  REDIS_SENTINEL_MASTER_NAME: z.string().default('mymaster'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}

export const env: Env = loadEnv();
```

```typescript
// backend/src/index.ts
import { createServer } from './server';
import { env } from './config/env';
import { logger } from './lib/logger';
import { startRedisMonitorIfEnabled, closeRedis } from './lib/redis';

async function main(): Promise<void> {
  const app = await createServer();

  const server = app.listen(env.PORT, () => {
    logger.info('Server started', { port: env.PORT, env: env.NODE_ENV });
  });

  // Initialize Redis Sentinel failover monitoring after the server starts.
  try {
    await startRedisMonitorIfEnabled();
  } catch (err) {
    logger.error('Failed to initialize Redis monitor', {
      error: (err as Error).message,
    });
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('Shutting down', { signal });
    server.close(async () => {
      await closeRedis();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: (err as Error).message });
  process.exit(1);
});
```

```typescript
// backend/src/lib/redis-monitor.test.ts
import { EventEmitter } from 'events';
import { RedisMonitor, parseSentinelPayload } from './redis-monitor';

class FakeRedis extends EventEmitter {
  public subscribed: string[] = [];
  public unsubscribed: string[] = [];
  public infoResponse = 'connected_clients:42\r\n';

  async subscribe(...channels: string[]): Promise<void> {
    this.subscribed.push(...channels);
  }

  async unsubscribe(...channels: string[]): Promise<void> {
    this.unsubscribed.push(...channels);
  }

  async info(_section: string): Promise<string> {
    return this.infoResponse;
  }

  emitMessage(channel: string, message: string): void {
    this.emit('message', channel, message);
  }
}

function createMocks() {
  const incrementCounter = jest.fn();
  const setGauge = jest.fn();
  const info = jest.fn();
  const warn = jest.fn();
  const error = jest.fn();
  return {
    metricsService: { incrementCounter, setGauge },
    loggerService: { info, warn, error },
    incrementCounter,
    setGauge,
    info,
    warn,
    error,
  };
}

describe('parseSentinelPayload', () => {
  it('parses +switch-master payloads', () => {
    const payload = parseSentinelPayload(
      '+switch-master',
      'mymaster 10.0.0.1 6379 10.0.0.2 6379',
      123,
    );
    expect(payload).toEqual({
      event: '+switch-master',
      raw: 'mymaster 10.0.0.1 6379 10.0.0.2 6379',
      masterName: 'mymaster',
      oldMaster: '10.0.0.1:6379',
      newMaster: '10.0.0.2:6379',
      timestamp: 123,
    });
  });

  it('parses +sdown payloads', () => {
    const payload = parseSentinelPayload('+sdown', 'mymaster 10.0.0.1 6379');
    expect(payload.masterName).toBe('mymaster');
    expect(payload.oldMaster).toBe('10.0.0.1:6379');
    expect(payload.newMaster).toBeUndefined();
  });
});

describe('RedisMonitor', () => {
  it('subscribes to Sentinel channels on start and unsubscribes on stop', async () => {
    const client = new FakeRedis();
    const mocks = createMocks();
    const monitor = new RedisMonitor({
      client: client as unknown as never,
      metricsService: mocks.metricsService,
      loggerService: mocks.loggerService,
      masterName: 'mymaster',
    });

    await monitor.start();
    expect(client.subscribed).toEqual(['+switch-master', '+reboot', '+sdown']);

    await monitor.stop();
    expect(client.unsubscribed).toEqual(['+switch-master', '+reboot', '+sdown']);
  });

  it('records metrics and logs on +switch-master', async () => {
    const client = new FakeRedis();
    const mocks = createMocks();
    const monitor = new RedisMonitor({
      client: client as unknown as never,
      metricsService: mocks.metricsService,
      loggerService: mocks.loggerService,
      masterName: 'mymaster',
    });

    await monitor.start();
    const eventSpy = jest.fn();
    monitor.on('+switch-master', eventSpy);

    client.emitMessage('+switch-master', 'mymaster 10.0.0.1 6379 10.0.0.2 6379');

    expect(mocks.incrementCounter).toHaveBeenCalledWith('redis_failover_events_total', {
      event: '+switch-master',
      old_master: '10.0.0.1:6379',
      new_master: '10.0.0.2:6379',
    });
    expect(mocks.info).toHaveBeenCalledWith(
      'Redis master failover detected',
      expect.objectContaining({
        oldMaster: '10.0.0.1:6379',
        newMaster: '10.0.0.2:6379',
      }),
    );
    expect(eventSpy).toHaveBeenCalledTimes(1);
  });

  it('logs a warning on +sdown', async () => {
    const client = new FakeRedis();
    const mocks = createMocks();
    const monitor = new RedisMonitor({
      client: client as unknown as never,
      metricsService: mocks.metricsService,
      loggerService: mocks.loggerService,
      masterName: 'mymaster',
    });

    await monitor.start();
    client.emitMessage('+sdown', 'mymaster 10.0.0.1 6379');

    expect(mocks.incrementCounter).toHaveBeenCalledWith('redis_failover_events_total', {
      event: '+sdown',
      old_master: '10.0.0.1:6379',
      new_master: '',
    });
    expect(mocks.warn).toHaveBeenCalledWith(
      'Redis master marked subjectively down',
      expect.objectContaining({ address: '10.0.0.1:6379' }),
    );
  });

  it('ignores events for other masters', async () => {
    const client = new FakeRedis();
    const mocks = createMocks();
    const monitor = new RedisMonitor({
      client: client as unknown as never,
      metricsService: mocks.metricsService,
      loggerService: mocks.loggerService,
      masterName: 'mymaster',
    });

    await monitor.start();
    client.emitMessage('+switch-master', 'othermaster 10.0.0.1 6379 10.0.0.2 6379');

    expect(mocks.incrementCounter).not.toHaveBeenCalled();
  });

  it('reports connected clients gauge', async () => {
    const client = new FakeRedis();
    const mocks = createMocks();
    const monitor = new RedisMonitor({
      client: client as unknown as never,
      metricsService: mocks.metricsService,
      loggerService: mocks.loggerService,
    });

    await monitor.reportConnectedClients();
    expect(mocks.setGauge).toHaveBeenCalledWith('redis_connected_clients', 42);
  });
});