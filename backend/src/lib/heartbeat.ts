/**
 * Dead-man's-switch heartbeats for background cron jobs (#1693).
 *
 * At the end of each successful run a scheduler pings an external heartbeat
 * monitor (Healthchecks.io, Better Uptime, or any URL that accepts a GET). The
 * monitor raises a high-severity alert when no ping arrives in time, which
 * catches schedulers that hang or die silently.
 *
 * Configure one check per job in the monitor with a grace period of 1.5x the
 * schedule interval, and set its ping URL in the matching env var:
 *
 * | Job                     | Env var                                | Interval | Alert after |
 * |-------------------------|----------------------------------------|----------|-------------|
 * | Daily fee report        | HEARTBEAT_FEE_REPORT_DAILY_URL         | 24h      | 36h         |
 * | Monthly fee report      | HEARTBEAT_FEE_REPORT_MONTHLY_URL       | ~31d     | ~46.5d      |
 * | KYC upload expiry       | HEARTBEAT_UPLOAD_EXPIRY_URL            | 1m       | 1.5m        |
 * | Transaction reconcile   | HEARTBEAT_TRANSACTION_RECONCILE_URL    | 10m      | 15m         |
 *
 * When a job's env var is unset its heartbeat is disabled.
 */

import logger from '../utils/logger';

/** Pings that take longer than this are abandoned. */
export const HEARTBEAT_TIMEOUT_MS = 5000;

/**
 * Ping the heartbeat monitor for `job`. Never throws: a monitor outage or
 * network error is logged and must not fail the job that just succeeded.
 */
export async function pingHeartbeat(job: string, url: string | undefined): Promise<void> {
  if (!url) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!response.ok) {
      logger.warn('Heartbeat ping rejected', { job, status: response.status });
    }
  } catch (error) {
    logger.warn('Heartbeat ping failed', {
      job,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    clearTimeout(timeout);
  }
}
