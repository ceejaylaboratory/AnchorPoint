import { encryptFields, decryptFields, verifyAuthTag, ENCRYPTED_FIELDS } from '../lib/prisma-encryption';

// Mock key management service
jest.mock('../lib/key-management.service', () => ({
  getKeyManagementService: jest.fn(() => ({
    encryptKey: jest.fn().mockResolvedValue({ ciphertext: 'encrypted_data', keyVersion: '1', algorithm: 'AES-256-GCM', timestamp: Date.now() }),
    decryptKey: jest.fn().mockResolvedValue('decrypted_data'),
  })),
}));

describe('Prisma Encryption Middleware', () => {
  describe('ENCRYPTED_FIELDS', () => {
    it('should include all PII fields', () => {
      expect(ENCRYPTED_FIELDS).toContain('firstName');
      expect(ENCRYPTED_FIELDS).toContain('lastName');
      expect(ENCRYPTED_FIELDS).toContain('email');
      expect(ENCRYPTED_FIELDS).toContain('bankAccountNumber');
      expect(ENCRYPTED_FIELDS).toContain('taxId');
    });
  });

  describe('encryptFields', () => {
    it('should encrypt specified fields', async () => {
      const data = { firstName: 'John', lastName: 'Doe', status: 'PENDING' };
      const { getKeyManagementService } = require('../lib/key-management.service');
      const mockKms = getKeyManagementService();

      const result = await encryptFields(data, ['firstName', 'lastName'], mockKms);

      expect(result.firstName).toBeDefined();
      expect(result.lastName).toBeDefined();
      expect(result.status).toBe('PENDING');
      expect(mockKms.encryptKey).toHaveBeenCalledTimes(2);
    });

    it('should handle empty data', async () => {
      const { getKeyManagementService } = require('../lib/key-management.service');
      const mockKms = getKeyManagementService();

      const result = await encryptFields({}, ['firstName'], mockKms);
      expect(result).toEqual({});
    });

    it('should skip non-string fields', async () => {
      const data = { firstName: 'John', age: 25 };
      const { getKeyManagementService } = require('../lib/key-management.service');
      const mockKms = getKeyManagementService();

      const result = await encryptFields(data, ['firstName', 'age'], mockKms);

      expect(result.firstName).toBeDefined();
      expect(result.age).toBe(25);
    });
  });

  describe('decryptFields', () => {
    it('should decrypt specified fields', async () => {
      const data = { firstName: 'enc:encrypted_value', lastName: 'enc:encrypted_value', status: 'PENDING' };
      const { getKeyManagementService } = require('../lib/key-management.service');
      const mockKms = getKeyManagementService();

      const result = await decryptFields(data, ['firstName', 'lastName'], mockKms);

      expect(result.firstName).toBe('decrypted_data');
      expect(result.lastName).toBe('decrypted_data');
      expect(mockKms.decryptKey).toHaveBeenCalledTimes(2);
    });

    it('should skip non-encrypted fields', async () => {
      const data = { firstName: 'plaintext', status: 'PENDING' };
      const { getKeyManagementService } = require('../lib/key-management.service');
      const mockKms = getKeyManagementService();

      const result = await decryptFields(data, ['firstName'], mockKms);

      expect(result.firstName).toBe('plaintext');
      expect(mockKms.decryptKey).not.toHaveBeenCalled();
    });
  });

  describe('verifyAuthTag', () => {
    it('should return true for plaintext', () => {
      expect(verifyAuthTag('plaintext')).toBe(true);
    });

    it('should return true for empty string', () => {
      expect(verifyAuthTag('')).toBe(true);
    });

    it('should return true for null', () => {
      expect(verifyAuthTag(null as any)).toBe(true);
    });

    it('should validate encrypted payload structure', () => {
      // Valid encrypted format: enc: + base64 payload with IV + authTag + encrypted data
      const mockEncrypted = 'enc:' + Buffer.from('a'.repeat(100)).toString('base64');
      expect(verifyAuthTag(mockEncrypted)).toBe(true);
    });
  });
});