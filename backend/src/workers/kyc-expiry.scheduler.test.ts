import { queueKycDocumentDeletion, permanentlyDeleteKycDocuments } from '../workers/kyc-expiry.scheduler';
import prisma from '../lib/prisma';
import { deleteFile } from '../services/storage-provider.service';

jest.mock('../lib/prisma');
jest.mock('../services/storage-provider.service');

describe('KYC Expiry Scheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('queueKycDocumentDeletion', () => {
    it('should update upload records to PENDING_DELETION', async () => {
      (prisma.uploadRecord.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

      await queueKycDocumentDeletion('customer123');

      expect(prisma.uploadRecord.updateMany).toHaveBeenCalledWith({
        where: {
          key: { contains: 'customer123' },
          isTemporary: true,
        },
        data: { status: 'PENDING_DELETION' },
      });
    });
  });

  describe('permanentlyDeleteKycDocuments', () => {
    it('should delete all KYC documents for a customer', async () => {
      const mockUploads = [
        { id: 'upload1', key: 'kyc/customer123/doc1' },
        { id: 'upload2', key: 'kyc/customer123/doc2' },
      ];

      (prisma.uploadRecord.findMany as jest.Mock).mockResolvedValue(mockUploads);
      (deleteFile as jest.Mock).mockResolvedValue(undefined);
      (prisma.uploadRecord.delete as jest.Mock).mockResolvedValue({});

      const result = await permanentlyDeleteKycDocuments('customer123');

      expect(result.deleted).toBe(2);
      expect(result.errors).toBe(0);
      expect(deleteFile).toHaveBeenCalledTimes(2);
    });

    it('should handle deletion errors gracefully', async () => {
      const mockUploads = [
        { id: 'upload1', key: 'kyc/customer123/doc1' },
      ];

      (prisma.uploadRecord.findMany as jest.Mock).mockResolvedValue(mockUploads);
      (deleteFile as jest.Mock).mockRejectedValue(new Error('Storage error'));
      (prisma.uploadRecord.delete as jest.Mock).mockResolvedValue({});

      const result = await permanentlyDeleteKycDocuments('customer123');

      expect(result.deleted).toBe(0);
      expect(result.errors).toBe(1);
    });

    it('should return zero when no uploads exist', async () => {
      (prisma.uploadRecord.findMany as jest.Mock).mockResolvedValue([]);

      const result = await permanentlyDeleteKycDocuments('customer123');

      expect(result.deleted).toBe(0);
      expect(result.errors).toBe(0);
    });
  });
});