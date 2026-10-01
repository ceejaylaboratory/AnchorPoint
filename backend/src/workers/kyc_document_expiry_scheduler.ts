import cron, { ScheduledTask } from 'node-cron';
import { processKycExpirationGracePeriod } from '../services/kyc.service';
import logger from '../utils/logger';

export class KycDocumentExpiryScheduler {
  private task: ScheduledTask | null = null;

  start(): void {
    // Run daily at midnight
    this.task = cron.schedule('0 0 * * *', async () => {
      try {
        // Query for documents expiring in 30 days
        const processedCount = await processKycExpirationGracePeriod(30);
        if (processedCount > 0) {
          logger.info(`Processed 30-day KYC document expiration for ${processedCount} customers`);
        }
      } catch (error) {
        logger.error('Failed to run KYC document 30-day expiry task', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    logger.info('KYC document expiry scheduler started (running daily at midnight for 30-day notice)');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    logger.info('KYC document expiry scheduler stopped');
  }
}

export const kycDocumentExpiryScheduler = new KycDocumentExpiryScheduler();
