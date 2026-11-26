import prisma from '../lib/prisma';
import { storageProvider } from './storage-provider.service';
import logger from '../utils/logger';

/** Legal retention period for soft-deleted customer records before permanent purge (#1197). */
export const KYC_RETENTION_YEARS = 7;

/** Queue key for KYC document purge jobs */
const KYC_DOCUMENT_PURGE_QUEUE = 'kyc_document_purge';

/**
 * Soft-deletes the KYC customer record for a user by stamping `deletedAt`.
 * Returns false when there is no live record to delete.
 */
export const softDeleteKycCustomer = async (userId: string): Promise<boolean> => {
  const { count } = await prisma.kycCustomer.updateMany({
    where: { userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return count > 0;
};

/** Returns the cutoff before which soft-deleted records are eligible for purging. */
export const getRetentionCutoff = (now: Date = new Date(), retentionYears: number = KYC_RETENTION_YEARS): Date => {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - retentionYears);
  return cutoff;
};

/**
 * Permanently deletes KYC customer records that were soft-deleted longer ago
 * than the retention period. Returns the number of purged records.
 */
export const purgeSoftDeletedKycCustomers = async (
  now: Date = new Date(),
  retentionYears: number = KYC_RETENTION_YEARS,
): Promise<number> => {
  const { count } = await prisma.kycCustomer.deleteMany({
    where: { deletedAt: { not: null, lt: getRetentionCutoff(now, retentionYears) } },
  });
  return count;
};

/**
 * Queue a background job to permanently purge KYC documents for a user.
 * Documents are deleted from storage after the retention period expires.
 */
export const queueKycDocumentPurge = async (userId: string): Promise<void> => {
  const redis = await import('../lib/redis').then((m) => m.redis);
  const job = JSON.stringify({ userId, queuedAt: new Date().toISOString() });
  await redis.lPush(KYC_DOCUMENT_PURGE_QUEUE, job);
  logger.info('KYC document purge job queued', { userId });
};

/**
 * Process queued KYC document purge jobs.
 * Deletes uploaded KYC documents from storage for soft-deleted customers.
 */
export const processKycDocumentPurgeQueue = async (): Promise<number> => {
  const redis = await import('../lib/redis').then((m) => m.redis);
  let processed = 0;

  while (true) {
    const job = await redis.rPop(KYC_DOCUMENT_PURGE_QUEUE);
    if (!job) break;

    try {
      const { userId } = JSON.parse(job);
      const customer = await prisma.kycCustomer.findUnique({
        where: { userId },
        select: { id: true, deletedAt: true },
      });

      if (customer?.deletedAt) {
        const cutoff = getRetentionCutoff(new Date(), KYC_RETENTION_YEARS);
        if (customer.deletedAt < cutoff) {
          // Find and delete associated upload records
          const uploads = await (prisma as any).uploadRecord.findMany({
            where: { key: { contains: userId } },
            select: { key: true },
          });

          for (const upload of uploads) {
            try {
              await storageProvider.deleteObject(upload.key);
            } catch (err) {
              logger.warn('Failed to delete KYC document during purge', { key: upload.key, error: err });
            }
          }
          processed++;
        }
      }
    } catch (err) {
      logger.error('Failed to process KYC document purge job', { error: err });
    }
  }

  return processed;
};
