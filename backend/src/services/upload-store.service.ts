import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import fs from 'fs';
import path from 'path';
import { generateStorageKey } from '../utils/storage-key';
import { getKeyManagementService } from '../lib/key-management.service';
import { EncryptedKey } from '../lib/key-management.types';

export type UploadStatus = 'PENDING' | 'COMPLETED' | 'EXPIRED' | 'EXPIRED_DELETED';

export interface UploadRecord {
  uploadId: string;
  account: string;
  fieldName: string;
  storageKey: string;
  contentType: string;
  expiresAt: Date;
  status: UploadStatus;
}

/** Lightweight in-memory store for upload records. */
const records = new Map<string, UploadRecord>();

export const uploadStore = {
  create(account: string, fieldName: string, contentType: string, expiresAt: Date): UploadRecord {
    const uploadId = randomUUID();
    const storageKey = generateStorageKey(account, fieldName, uploadId);
    const record: UploadRecord = { uploadId, account, fieldName, storageKey, contentType, expiresAt, status: 'PENDING' };
    records.set(uploadId, record);
    return record;
  },

  get(uploadId: string): UploadRecord | undefined {
    return records.get(uploadId);
  },

  setStatus(uploadId: string, status: UploadStatus): void {
    const r = records.get(uploadId);
    if (r) r.status = status;
  },

  setStorageKey(uploadId: string, storageKey: string): void {
    const r = records.get(uploadId);
    if (r) r.storageKey = storageKey;
  },

  /** Test helper: clear all in-memory records. */
  _reset(): void {
    records.clear();
  },

  expireStale(): number {
    const now = new Date();
    let count = 0;
    for (const r of records.values()) {
      if (r.status === 'PENDING' && r.expiresAt < now) {
        r.status = 'EXPIRED';
        count++;
      }
    }
    return count;
  },
};

// ── KYC document encryption at rest ───────────────────────────────────
// Documents are encrypted with AES-256-GCM using a per-document data key.
// The data key is wrapped by the configured KMS/Vault backend, so only
// ciphertext and the wrapped key are ever written to storage.
//
// Encrypted file layout:
//   MAGIC | uint32 header length | JSON header { wrappedKey, iv, authTag } | ciphertext

const ENCRYPTED_DOCUMENT_MAGIC = Buffer.from('APKYC1');
const DOCUMENT_CIPHER = 'aes-256-gcm';

/** Default directory where SEP-12 multipart uploads are written. */
export const KYC_UPLOAD_DIR = path.join(process.cwd(), 'uploads/kyc');

interface EncryptedDocumentHeader {
  wrappedKey: EncryptedKey;
  iv: string;
  authTag: string;
}

/** Returns true when `data` was produced by `encryptDocument`. */
export function isEncryptedDocument(data: Buffer): boolean {
  return (
    data.length >= ENCRYPTED_DOCUMENT_MAGIC.length + 4 &&
    data.subarray(0, ENCRYPTED_DOCUMENT_MAGIC.length).equals(ENCRYPTED_DOCUMENT_MAGIC)
  );
}

/** Encrypts a document with a fresh KMS-wrapped AES-256-GCM data key. */
export async function encryptDocument(plaintext: Buffer): Promise<Buffer> {
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  try {
    const wrappedKey = await getKeyManagementService().encryptKey(dataKey.toString('base64'));
    const cipher = createCipheriv(DOCUMENT_CIPHER, dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const header: EncryptedDocumentHeader = {
      wrappedKey,
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    const headerLength = Buffer.alloc(4);
    headerLength.writeUInt32BE(headerBytes.length, 0);
    return Buffer.concat([ENCRYPTED_DOCUMENT_MAGIC, headerLength, headerBytes, ciphertext]);
  } finally {
    dataKey.fill(0);
  }
}

/** Decrypts a document produced by `encryptDocument`. */
export async function decryptDocument(data: Buffer): Promise<Buffer> {
  if (!isEncryptedDocument(data)) {
    throw new Error('Document is not in the encrypted document format');
  }
  const headerStart = ENCRYPTED_DOCUMENT_MAGIC.length + 4;
  const headerLength = data.readUInt32BE(ENCRYPTED_DOCUMENT_MAGIC.length);
  const header = JSON.parse(
    data.subarray(headerStart, headerStart + headerLength).toString('utf8')
  ) as EncryptedDocumentHeader;
  const ciphertext = data.subarray(headerStart + headerLength);

  const dataKey = Buffer.from(
    await getKeyManagementService().decryptKey(header.wrappedKey),
    'base64'
  );
  try {
    const decipher = createDecipheriv(DOCUMENT_CIPHER, dataKey, Buffer.from(header.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(header.authTag, 'base64'));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } finally {
    dataKey.fill(0);
  }
}

/** Encrypts a stored document in place. Already-encrypted files are left untouched. */
export async function encryptStoredDocument(filePath: string): Promise<boolean> {
  const data = await fs.promises.readFile(filePath);
  if (isEncryptedDocument(data)) {
    return false;
  }
  await writeFileAtomic(filePath, await encryptDocument(data));
  return true;
}

/** Download path: returns the plaintext of a stored document. */
export async function readStoredDocument(filePath: string): Promise<Buffer> {
  const data = await fs.promises.readFile(filePath);
  return isEncryptedDocument(data) ? decryptDocument(data) : data;
}

/**
 * Re-encrypts every stored document under the current KMS key version.
 * Plain-text documents are encrypted as part of the pass.
 */
export async function reencryptStoredDocuments(dir: string = KYC_UPLOAD_DIR): Promise<number> {
  let count = 0;
  for (const filePath of await listDocumentFiles(dir)) {
    const plaintext = await readStoredDocument(filePath);
    await writeFileAtomic(filePath, await encryptDocument(plaintext));
    count++;
  }
  return count;
}

/** One-time migration: encrypts any stored documents still in plain text. */
export async function encryptPlaintextDocuments(dir: string = KYC_UPLOAD_DIR): Promise<number> {
  let count = 0;
  for (const filePath of await listDocumentFiles(dir)) {
    if (await encryptStoredDocument(filePath)) {
      count++;
    }
  }
  return count;
}

async function listDocumentFiles(dir: string): Promise<string[]> {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(dir, e.name));
}

async function writeFileAtomic(filePath: string, data: Buffer): Promise<void> {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.promises.writeFile(tmpPath, data);
  await fs.promises.rename(tmpPath, filePath);
}
