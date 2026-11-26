import cron, { ScheduledTask } from 'node-cron';
import { uploadStore } from '../services/upload-store.service';
import { storageProvider } from '../services/storage-provider.service';
import prisma from '../lib/prisma';
import { pingHeartbeat } from '../lib/heartbeat';
import logger from '../utils/logger';
import { getRetentionCutoff, KYC_RETENTION_YEARS } from '../services/data-retention.service';

const TTL_DAYS = 30;

export class UploadExpiryScheduler {
  private task: ScheduledTask | null = null;

  start(): void {
    // Run every minute to expire stale uploads
    this.task = cron.schedule('* * * * *', async () => {
      let succeeded = true;
      try {
        // In-memory fallback expiry
        const expiredCount = uploadStore.expireStale();
        if (expiredCount > 0) {
          logger.info(`Expired ${expiredCount} stale KYC upload records (in-memory)`);
        }
      } catch (error) {
        logger.error('Failed to run in-memory upload expiry task', { error });
        succeeded = false;
      }

      try {
        await this.expireDbUploads();
      } catch (error) {
        logger.error('Failed to run DB upload expiry task', { error });
        succeeded = false;
      }

      if (succeeded) {
        await pingHeartbeat('upload-expiry', process.env.HEARTBEAT_UPLOAD_EXPIRY_URL);
      }

      try {
        // Purge expired KYC documents once per hour (every 60th minute)
        const now = new Date();
        if (now.getMinutes() === 0) {
          await this.purgeExpiredKycDocuments();
        }
      } catch (error) {
        logger.error('Failed to run KYC document purge task', { error });
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

  /** Query DB for temporary uploads older than TTL_DAYS and delete them from storage. */
  async expireDbUploads(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - TTL_DAYS);

    const records = await (prisma as any).uploadRecord.findMany({
      where: {
        isTemporary: true,
        status: { not: 'EXPIRED_DELETED' },
        createdAt: { lt: cutoff },
      },
      select: { id: true, key: true },
    });

    if (records.length === 0) return 0;

    let deleted = 0;
    for (const record of records) {
      try {
        await storageProvider.deleteObject(record.key);
        await (prisma as any).uploadRecord.update({
          where: { id: record.id },
          data: { status: 'EXPIRED_DELETED' },
        });
        deleted++;
      } catch (error) {
        logger.error('Failed to expire upload record', { id: record.id, key: record.key, error });
      }
    }

    if (deleted > 0) {
      logger.info(`Expired and deleted ${deleted} temporary upload records from storage`);
    }

    return deleted;
  }

  /**
   * Permanently purge KYC documents for customers past retention period.
   * Called by background scheduler to clean up documents after GDPR retention.
   */
  async purgeExpiredKycDocuments(): Promise<number> {
    const cutoff = getRetentionCutoff(new Date(), KYC_RETENTION_YEARS);

    const expiredCustomers = await prisma.kycCustomer.findMany({
      where: {
        deletedAt: { not: null, lt: cutoff },
      },
      select: { id: true, userId: true },
    });

    if (expiredCustomers.length === 0) return 0;

    let purged = 0;
    for (const customer of expiredCustomers) {
      try {
        const uploads = await (prisma as any).uploadRecord.findMany({
          where: { key: { contains: customer.userId } },
          select: { key: true },
        });

        for (const upload of uploads) {
          try {
            await storageProvider.deleteObject(upload.key);
          } catch (err) {
            logger.warn('Failed to delete KYC document', { key: upload.key, error: err });
          }
        }

        await prisma.kycCustomer.delete({ where: { id: customer.id } });
        purged++;
      } catch (error) {
        logger.error('Failed to purge KYC customer documents', { customerId: customer.id, error });
      }
    }

    if (purged > 0) {
      logger.info(`Purged ${purged} expired KYC customer records and documents`);
    }

    return purged;
  }
}

export const uploadExpiryScheduler = new UploadExpiryScheduler();
