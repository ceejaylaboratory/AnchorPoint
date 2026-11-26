import { config } from '../config/env';
import { connectWithRetry, prismaRaw } from '../lib/prisma';
import { metricsService } from './metrics.service';
import logger from '../utils/logger';

interface DatabaseClientLike {
  $queryRaw: (...args: unknown[]) => Promise<unknown>;
  $connect: () => Promise<void>;
  $disconnect: () => Promise<void>;
}

export interface DatabaseHealthState {
  healthy: boolean;
  consecutiveFailures: number;
  lastCheckAt: string | null;
  lastSuccessAt: string | null;
  lastReconnectAt: string | null;
}

/**
 * #1588: periodically probes the database and recycles the Prisma pool after
 * repeated failures (e.g. a dropped socket behind an LB/NAT gateway).
 */
export class DatabaseHealthService {
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  private state: DatabaseHealthState = {
    healthy: true,
    consecutiveFailures: 0,
    lastCheckAt: null,
    lastSuccessAt: null,
    lastReconnectAt: null,
  };

  constructor(
    private readonly client: DatabaseClientLike = prismaRaw as unknown as DatabaseClientLike,
    private readonly intervalMs: number = config.DB_HEALTHCHECK_INTERVAL_MS,
    private readonly failureThreshold: number = config.DB_RECONNECT_FAILURE_THRESHOLD
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.check();
    }, this.intervalMs);
    this.timer.unref?.();
    logger.info(`DatabaseHealthService: probing every ${this.intervalMs}ms`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isHealthy(): boolean {
    return this.state.healthy;
  }

  getState(): DatabaseHealthState {
    return { ...this.state };
  }

  /** Run one health probe. Returns true when the query succeeded. */
  async check(): Promise<boolean> {
    if (this.checking) return this.state.healthy;
    this.checking = true;
    try {
      await this.client.$queryRaw`SELECT 1`;
      this.state.healthy = true;
      this.state.consecutiveFailures = 0;
      this.state.lastCheckAt = new Date().toISOString();
      this.state.lastSuccessAt = this.state.lastCheckAt;
      metricsService.setDbConnectionHealth(true);
      return true;
    } catch (error) {
      this.state.healthy = false;
      this.state.consecutiveFailures += 1;
      this.state.lastCheckAt = new Date().toISOString();
      metricsService.setDbConnectionHealth(false);
      metricsService.incrementDbHealthcheckFailure();
      logger.warn('DatabaseHealthService: health check failed', {
        consecutiveFailures: this.state.consecutiveFailures,
        error: error instanceof Error ? error.message : String(error),
      });
      if (this.state.consecutiveFailures >= this.failureThreshold) {
        await this.reconnect();
      }
      return false;
    } finally {
      this.checking = false;
    }
  }

  private async reconnect(): Promise<void> {
    try {
      logger.warn('DatabaseHealthService: recycling Prisma connection pool', {
        consecutiveFailures: this.state.consecutiveFailures,
      });
      await this.client.$disconnect();
      await connectWithRetry(this.client as unknown as Parameters<typeof connectWithRetry>[0]);
      this.state.consecutiveFailures = 0;
      this.state.healthy = true;
      this.state.lastReconnectAt = new Date().toISOString();
      metricsService.setDbConnectionHealth(true);
      metricsService.incrementDbReconnect();
      logger.info('DatabaseHealthService: Prisma pool reconnected');
    } catch (error) {
      logger.error('DatabaseHealthService: failed to reconnect Prisma pool', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const databaseHealthService = new DatabaseHealthService();
