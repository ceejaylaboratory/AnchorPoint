import cron, { ScheduledTask } from 'node-cron';
import { uploadStore } from '../services/upload-store.service';
import logger from '../utils/logger';

export class UploadExpiryScheduler {
  private task: ScheduledTask | null = null;

  start(): void {
    // Run every minute to expire stale uploads
    this.task = cron.schedule('* * * * *', () => {
      try {
        const expiredCount = uploadStore.expireStale();
        if (expiredCount > 0) {
          logger.info(`Expired ${expiredCount} stale KYC upload records`);
        }
      } catch (error) {
        logger.error('Failed to run upload expiry task', { error });
      }
    });

    logger.info('⏰ Upload expiry scheduler started (running every minute)');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    logger.info('Upload expiry scheduler stopped');
  }
}

export const uploadExpiryScheduler = new UploadExpiryScheduler();
