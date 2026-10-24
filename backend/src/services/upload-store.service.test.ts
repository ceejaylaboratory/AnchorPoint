import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  uploadStore,
  encryptDocument,
  decryptDocument,
  isEncryptedDocument,
  encryptStoredDocument,
  readStoredDocument,
  reencryptStoredDocuments,
} from './upload-store.service';

jest.mock('../lib/key-management.service', () => {
  let version = 1;
  return {
    getKeyManagementService: () => ({
      encryptKey: jest.fn(async (plaintext: string) => ({
        ciphertext: Buffer.from(`wrapped:${plaintext}`).toString('base64'),
        keyVersion: `v${version}`,
        algorithm: 'AES-256-GCM',
        timestamp: Date.now(),
      })),
      decryptKey: jest.fn(async (encrypted: { ciphertext: string }) =>
        Buffer.from(encrypted.ciphertext, 'base64').toString('utf8').replace(/^wrapped:/, '')
      ),
    }),
    __rotate: () => {
      version++;
    },
  };
});

describe('uploadStore', () => {
  beforeEach(() => {
    // Clear in-memory maps or stale records if any
    const recordsMap = (uploadStore as any).records;
    if (recordsMap) {
      recordsMap.clear();
    }
  });

  it('should create and retrieve an upload record', () => {
    const expiresAt = new Date(Date.now() + 60000);
    const record = uploadStore.create(
      'GD3...123',
      'id_front',
      'image/png',
      expiresAt
    );

    expect(record.uploadId).toBeDefined();
    expect(record.status).toBe('PENDING');
    expect(record.account).toBe('GD3...123');

    const fetched = uploadStore.get(record.uploadId);
    expect(fetched).toEqual(record);
  });

  it('should set the status of a record', () => {
    const expiresAt = new Date(Date.now() + 60000);
    const record = uploadStore.create(
      'GD3...123',
      'id_front',
      'image/png',
      expiresAt
    );

    uploadStore.setStatus(record.uploadId, 'COMPLETED');
    expect(uploadStore.get(record.uploadId)?.status).toBe('COMPLETED');
  });

  it('should expire stale records', () => {
    const pastDate = new Date(Date.now() - 10000);
    const record = uploadStore.create(
      'GD3...123',
      'id_front',
      'image/png',
      pastDate
    );

    const expiredCount = uploadStore.expireStale();
    expect(expiredCount).toBe(1);
    expect(uploadStore.get(record.uploadId)?.status).toBe('EXPIRED');
  });
});

describe('KYC document encryption', () => {
  const plaintext = Buffer.from('%PDF-1.4 sensitive kyc document');

  it('round-trips a document through encrypt/decrypt', async () => {
    const encrypted = await encryptDocument(plaintext);

    expect(isEncryptedDocument(encrypted)).toBe(true);
    expect(encrypted.includes(plaintext)).toBe(false);
    expect((await decryptDocument(encrypted)).equals(plaintext)).toBe(true);
  });

  it('rejects tampered ciphertext', async () => {
    const encrypted = await encryptDocument(plaintext);
    encrypted[encrypted.length - 1] ^= 0xff;

    await expect(decryptDocument(encrypted)).rejects.toThrow();
  });

  it('encrypts stored files in place, decrypts on read and re-encrypts on rotation', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kyc-docs-'));
    const filePath = path.join(dir, 'photo_id_front.pdf');
    fs.writeFileSync(filePath, plaintext);

    try {
      expect(await encryptStoredDocument(filePath)).toBe(true);
      expect(await encryptStoredDocument(filePath)).toBe(false);
      expect(isEncryptedDocument(fs.readFileSync(filePath))).toBe(true);
      expect((await readStoredDocument(filePath)).equals(plaintext)).toBe(true);

      const before = fs.readFileSync(filePath);
      jest.requireMock('../lib/key-management.service').__rotate();
      expect(await reencryptStoredDocuments(dir)).toBe(1);

      const after = fs.readFileSync(filePath);
      expect(after.equals(before)).toBe(false);
      expect(after.toString('utf8')).toContain('"keyVersion":"v2"');
      expect((await readStoredDocument(filePath)).equals(plaintext)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
