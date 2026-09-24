jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    kycCustomer: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

import prisma from '../lib/prisma';
import {
  KYC_RETENTION_YEARS,
  getRetentionCutoff,
  purgeSoftDeletedKycCustomers,
  softDeleteKycCustomer,
} from './data-retention.service';

const kycCustomer = prisma.kycCustomer as unknown as {
  updateMany: jest.Mock;
  deleteMany: jest.Mock;
};

describe('data retention service (#1197)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('soft-deletes a live KYC customer by stamping deletedAt', async () => {
    kycCustomer.updateMany.mockResolvedValue({ count: 1 });

    await expect(softDeleteKycCustomer('user-1')).resolves.toBe(true);

    expect(kycCustomer.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('returns false when there is no live record to soft-delete', async () => {
    kycCustomer.updateMany.mockResolvedValue({ count: 0 });

    await expect(softDeleteKycCustomer('user-1')).resolves.toBe(false);
  });

  it('uses a 7-year retention period', () => {
    expect(KYC_RETENTION_YEARS).toBe(7);
    expect(getRetentionCutoff(new Date('2030-06-15T00:00:00Z'))).toEqual(
      new Date('2023-06-15T00:00:00Z')
    );
  });

  it('purges only records soft-deleted before the retention cutoff', async () => {
    kycCustomer.deleteMany.mockResolvedValue({ count: 4 });

    const purged = await purgeSoftDeletedKycCustomers(new Date('2030-06-15T00:00:00Z'));

    expect(purged).toBe(4);
    expect(kycCustomer.deleteMany).toHaveBeenCalledWith({
      where: { deletedAt: { not: null, lt: new Date('2023-06-15T00:00:00Z') } },
    });
  });
});
