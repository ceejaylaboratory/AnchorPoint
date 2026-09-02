import { metricsService } from '../services/metrics.service';
import prisma from '../lib/prisma';
import logger from '../utils/logger';

/** Default pool limit when DB_CONNECTION_LIMIT is unset (matches config/env.ts). */
const DEFAULT_DB_CONNECTION_LIMIT = 20;

/**
 * #1008: Periodically sample the active database connection count and keep the
 * pool limit gauge in sync so the `DatabaseConnectionExhausted` Prometheus
 * alert has a live signal.
 *
 * Only Postgres exposes connection statistics (`pg_stat_activity`); SQLite
 * dev/test datasources are skipped (gauges simply stay unset / zero).
 */
export class DbMetricsScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs = 15_000;

  start(): void {
    if (!this.isPostgres()) {
      logger.info('DbMetricsScheduler: skipping DB connection sampling (non-Postgres datasource)');
      // Still publish the pool limit so alerts against it don't divide by zero.
      metricsService.setDbConnectionsLimit(this.poolLimit());
      return;
    }

    // Seed immediately, then sample on an interval.
    this.sample().catch((err) => {
      logger.error('DbMetricsScheduler: initial sampling failed', { error: err });
    });
    this.timer = setInterval(() => {
      this.sample().catch((err) => {
        logger.error('DbMetricsScheduler: sampling failed', { error: err });
      });
    }, this.intervalMs);
    logger.info(`DbMetricsScheduler: sampling DB connections every ${this.intervalMs}ms`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private isPostgres(): boolean {
    const url = process.env.DATABASE_URL ?? '';
    return url.startsWith('postgresql://') || url.startsWith('postgres://');
  }

  private poolLimit(): number {
    const raw = process.env.DB_CONNECTION_LIMIT;
    if (!raw) return DEFAULT_DB_CONNECTION_LIMIT;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DB_CONNECTION_LIMIT;
  }

  private async sample(): Promise<void> {
    metricsService.setDbConnectionsLimit(this.poolLimit());

    const rows = await prisma.$queryRawUnsafe<Array<{ active_connections: bigint | number }>>(
      `SELECT count(*)::bigint AS active_connections
         FROM pg_stat_activity
        WHERE datname = current_database()`,
    );
    const active = Number(rows[0]?.active_connections ?? 0);
    metricsService.setDbConnectionsActive(active);
  }
}

// Export a singleton instance
export const dbMetricsScheduler = new DbMetricsScheduler();
