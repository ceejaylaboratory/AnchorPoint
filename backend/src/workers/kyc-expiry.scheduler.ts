import { Worker } from 'bullmq';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { deleteFile } from '../services/storage-provider.service';

const KYC_DOCUMENT_RETENTION_DAYS = 30;

/**
 * Queue KYC document deletion for a customer
 */
export async function queueKycDocumentDeletion(customerId: string): Promise<void> {
  const deleteAt = new Date();
  deleteAt.setDate(deleteAt.getDate() + KYC_DOCUMENT_RETENTION_DAYS);
  
  await prisma.uploadRecord.updateMany({
    where: {
      key: { contains: customerId },
      isTemporary: true,
    },
    data: {
      status: 'PENDING_DELETION',
    },
  });
  
  logger.info('Queued KYC document deletion', { customerId, deleteAt });
}

/**
 * Permanently delete KYC documents for a customer
 */
export async function permanentlyDeleteKycDocuments(customerId: string): Promise<{ deleted: number; errors: number }> {
  let deleted = 0;
  let errors = 0;
  
  try {
    const uploads = await prisma.uploadRecord.findMany({
      where: {
        key: { contains: customerId },
        isTemporary: true,
      },
    });
    
    for (const upload of uploads) {
      try {
        await deleteFile(upload.key);
        await prisma.uploadRecord.delete({ where: { id: upload.id } });
        deleted++;
      } catch (err) {
        logger.warn('Failed to delete KYC document', { key: upload.key, error: err });
        errors++;
      }
    }
  } catch (err) {
    logger.error('KYC document deletion failed', { customerId, error: err });
  }
  
  return { deleted, errors };
}

/**
 * Worker for processing KYC document expiration
 */
export function createKycExpiryWorker(): Worker {
  return new Worker(
    'kyc-expiry',
    async (job) => {
      const { customerId, action } = job.data;
      
      if (action === 'queue_deletion') {
        await queueKycDocumentDeletion(customerId);
      } else if (action === 'permanent_delete') {
        return await permanentlyDeleteKycDocuments(customerId);
      }
    },
    {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD,
      },
    }
  );
}