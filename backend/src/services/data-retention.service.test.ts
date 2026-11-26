import { softDeleteKycCustomer, queueKycDocumentPurge, processKycDocumentPurgeQueue, getRetentionCutoff } from '../services/data-retention.service';
import prisma from '../lib/prisma';

jest.mock('../lib/prisma');
jest.mock('../lib/redis', () => ({
  redis: {
    lPush: jest.fn().mockResolvedValue(1),
    rPop: jest.fn().mockResolvedValue(null),
  },
}));
jest.mock('../services/storage-provider.service', () => ({
  storageProvider: {
    deleteObject: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('Data Retention Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('softDeleteKycCustomer', () => {
    it('should soft-delete customer record', async () => {
      (prisma.kycCustomer.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await softDeleteKycCustomer('user-123');

      expect(result).toBe(true);
      expect(prisma.kycCustomer.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-123', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should return false when no record found', async () => {
      (prisma.kycCustomer.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const result = await softDeleteKycCustomer('user-456');

      expect(result).toBe(false);
    });
  });

  describe('getRetentionCutoff', () => {
    it('should return date 7 years ago', () => {
      const cutoff = getRetentionCutoff(new Date('2024-01-01'));
      expect(cutoff.getFullYear()).toBe(2017);
    });
  });

  describe('queueKycDocumentPurge', () => {
    it('should push job to redis queue', async () => {
      const { redis } = await import('../lib/redis');
      await queueKycDocumentPurge('user-123');

      expect(redis.lPush).toHaveBeenCalledWith(
        'kyc_document_purge',
        expect.stringContaining('user-123')
      );
    });
  });

  describe('processKycDocumentPurgeQueue', () => {
    it('should process and return count', async () => {
      const { redis } = await import('../lib/redis');
      (redis.rPop as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify({ userId: 'user-123' }))
        .mockResolvedValueOnce(null);

      (prisma.kycCustomer.findUnique as jest.Mock).mockResolvedValue({
        id: 'cust-123',
        deletedAt: new Date('2020-01-01'),
      });

      const count = await processKycDocumentPurgeQueue();

      expect(count).toBe(1);
    });
  });
});