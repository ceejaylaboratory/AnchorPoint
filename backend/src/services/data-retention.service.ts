import prisma from '../lib/prisma';

/** Legal retention period for soft-deleted customer records before permanent purge (#1197). */
export const KYC_RETENTION_YEARS = 7;

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
