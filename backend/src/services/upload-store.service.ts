import { randomUUID } from 'crypto';

export type UploadStatus = 'PENDING' | 'COMPLETED' | 'EXPIRED';

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
  create(account: string, fieldName: string, storageKey: string, contentType: string, expiresAt: Date): UploadRecord {
    const uploadId = randomUUID();
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
