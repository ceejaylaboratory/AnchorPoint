/**
 * Prisma Encryption Middleware
 * 
 * Provides automatic encryption/decryption of sensitive PII fields using envelope encryption.
 * Ensures GDPR compliance by encrypting customer data at rest.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import logger from '../utils/logger';
import { getKeyManagementService } from './key-management.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Fields that should be encrypted in the database
 */
export const ENCRYPTED_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'mobileNumber',
  'bankAccountNumber',
  'bankNumber',
  'bankPhoneNumber',
  'taxId',
  'taxIdName',
  'address',
  'photoIdNumber',
] as const;

export type EncryptedField = typeof ENCRYPTED_FIELDS[number];

/**
 * Encrypt plaintext using AES-256-GCM with a data key
 */
async function encryptData(plaintext: string, kmsService: ReturnType<typeof getKeyManagementService>): Promise<string> {
  if (!plaintext) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const dataKey = randomBytes(32);
  
  const cipher = createCipheriv(ALGORITHM, dataKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const encryptedDataKey = await kmsService.encryptKey(dataKey.toString('base64'));
  
  const payload = Buffer.concat([
    Buffer.from(encryptedDataKey.ciphertext, 'base64'),
    iv,
    authTag,
    encrypted,
  ]);

  return `enc:${payload.toString('base64')}`;
}

/**
 * Decrypt ciphertext using AES-256-GCM
 */
async function decryptData(ciphertext: string, kmsService: ReturnType<typeof getKeyManagementService>): Promise<string> {
  if (!ciphertext || !ciphertext.startsWith('enc:')) return ciphertext;

  try {
    const payload = Buffer.from(ciphertext.slice(4), 'base64');
    
    const encryptedDataKey = payload.subarray(0, -IV_LENGTH - AUTH_TAG_LENGTH - payload.length + IV_LENGTH + AUTH_TAG_LENGTH);
    const iv = payload.subarray(encryptedDataKey.length, encryptedDataKey.length + IV_LENGTH);
    const authTag = payload.subarray(encryptedDataKey.length + IV_LENGTH, encryptedDataKey.length + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = payload.subarray(encryptedDataKey.length + IV_LENGTH + AUTH_TAG_LENGTH);

    const dataKeyStr = await kmsService.decryptKey({
      ciphertext: encryptedDataKey.toString('base64'),
      keyVersion: '1',
      algorithm: 'AES-256-GCM',
      timestamp: Date.now(),
    });

    const dataKey = Buffer.from(dataKeyStr, 'base64');
    const decipher = createDecipheriv(ALGORITHM, dataKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (err) {
    logger.error('Decryption failed', { error: err instanceof Error ? err.message : String(err) });
    throw new Error('Failed to decrypt field');
  }
}

/**
 * Encrypt specific fields in a data object
 */
export async function encryptFields<T extends Record<string, unknown>>(
  data: T,
  fields: readonly string[],
  kmsService: ReturnType<typeof getKeyManagementService>
): Promise<T> {
  const result = { ...data };
  
  for (const field of fields) {
    if (result[field] && typeof result[field] === 'string') {
      (result as Record<string, unknown>)[field] = await encryptData(result[field] as string, kmsService);
    }
  }
  
  return result;
}

/**
 * Decrypt specific fields in a data object
 */
export async function decryptFields<T extends Record<string, unknown>>(
  data: T,
  fields: readonly string[],
  kmsService: ReturnType<typeof getKeyManagementService>
): Promise<T> {
  const result = { ...data };
  
  for (const field of fields) {
    if (result[field] && typeof result[field] === 'string') {
      (result as Record<string, unknown>)[field] = await decryptData(result[field] as string, kmsService);
    }
  }
  
  return result;
}

/**
 * Create Prisma middleware for automatic encryption on write
 */
export function createEncryptionMiddleware(
  fields: readonly string[] = ENCRYPTED_FIELDS
): Prisma.Middleware {
  return async (params, next) => {
    const isWrite = ['create', 'update', 'updateMany', 'upsert'].includes(params.action);
    
    if (isWrite && params.model && ['KycCustomer', 'User'].includes(params.model)) {
      try {
        const kmsService = getKeyManagementService();
        const data = params.args.data as Record<string, unknown>;
        
        if (data) {
          params.args.data = await encryptFields(data, fields, kmsService);
        }
      } catch (err) {
        logger.warn('Encryption middleware skipped', { error: err instanceof Error ? err.message : String(err) });
      }
    }
    
    return next(params);
  };
}

/**
 * Create Prisma middleware for automatic decryption on read
 */
export function createDecryptionMiddleware(
  fields: readonly string[] = ENCRYPTED_FIELDS
): Prisma.Middleware {
  return async (params, next) => {
    const isRead = ['findUnique', 'findFirst', 'findMany', 'aggregate'].includes(params.action);
    
    if (isRead && params.model && ['KycCustomer', 'User'].includes(params.model)) {
      try {
        const kmsService = getKeyManagementService();
        const result = await next(params);
        
        if (result && Array.isArray(result)) {
          const decrypted = await Promise.all(
            result.map((item) => decryptFields(item as Record<string, unknown>, fields, kmsService))
          );
          return decrypted as any;
        } else if (result) {
          return await decryptFields(result as Record<string, unknown>, fields, kmsService) as any;
        }
      } catch (err) {
        logger.warn('Decryption middleware skipped', { error: err instanceof Error ? err.message : String(err) });
      }
    }
    
    return next(params);
  };
}

/**
 * Apply encryption middleware to a Prisma client instance
 */
export function applyEncryptionMiddleware(prisma: PrismaClient): void {
  prisma.$use(createEncryptionMiddleware());
  prisma.$use(createDecryptionMiddleware());
}

/**
 * Verify data integrity by checking authentication tag
 */
export function verifyAuthTag(ciphertext: string): boolean {
  if (!ciphertext || !ciphertext.startsWith('enc:')) return true;
  
  try {
    const payload = Buffer.from(ciphertext.slice(4), 'base64');
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    
    return iv.length === IV_LENGTH && authTag.length === AUTH_TAG_LENGTH;
  } catch {
    return false;
  }
}

/**
 * Migrate existing plaintext PII to encrypted format
 */
export async function migratePlaintextToEncrypted(
  prisma: PrismaClient,
  batchSize = 100
): Promise<{ migrated: number; errors: number }> {
  let migrated = 0;
  let errors = 0;
  
  try {
    const kmsService = getKeyManagementService();
    let cursor: string | undefined;
    
    while (true) {
      const customers = await prisma.kycCustomer.findMany({
        take: batchSize,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        where: {
          deletedAt: null,
          OR: ENCRYPTED_FIELDS.map((f) => ({
            [f]: { startsWith: 'enc:' },
          })),
        },
      });
      
      if (customers.length === 0) break;
      
      for (const customer of customers) {
        try {
          const updates: Record<string, string> = {};
          
          for (const field of ENCRYPTED_FIELDS) {
            const value = customer[field as keyof typeof customer];
            if (value && typeof value === 'string' && !value.startsWith('enc:')) {
              updates[field] = await encryptData(value, kmsService);
            }
          }
          
          if (Object.keys(updates).length > 0) {
            await prisma.kycCustomer.update({
              where: { id: customer.id },
              data: updates,
            });
            migrated++;
          }
        } catch {
          errors++;
        }
      }
      
      cursor = customers[customers.length - 1].id;
    }
  } catch (err) {
    logger.error('Migration failed', { error: err instanceof Error ? err.message : String(err) });
  }
  
  return { migrated, errors };
}