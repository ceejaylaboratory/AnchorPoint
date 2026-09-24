import cron, { ScheduledTask } from 'node-cron';
import { purgeSoftDeletedKycCustomers } from '../services/data-retention.service';
import logger from '../utils/logger';

/**
 * Daily job that permanently purges soft-deleted KYC customer records once
 * they are past the legal retention period (#1197).
 */
export class DataRetentionScheduler {
  private task: ScheduledTask | null = null;

  start(): void {
    this.task = cron.schedule('0 3 * * *', async () => {
      try {
        const purgedCount = await purgeSoftDeletedKycCustomers();
        if (purgedCount > 0) {
          logger.info(`Purged ${purgedCount} soft-deleted KYC customers past the retention period`);
        }
      } catch (error) {
        logger.error('Failed to run data retention purge task', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    logger.info('Data retention purge scheduler started (running daily at 03:00)');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    logger.info('Data retention purge scheduler stopped');
  }
}

export const dataRetentionScheduler = new DataRetentionScheduler();
