/**
 * Key Management Service Tests
 * 
 * Tests for encrypted key storage and retrieval.
 * All vault/KMS calls are mocked to avoid external dependencies.
 */

import {
  KeyManagementError,
  KeyManagementErrorType,
  EncryptedKey,
} from './key-management.types';
import { createKeyManagementService, initializeKeyManagement, getKeyManagementService } from './key-management.service';

// Mock AWS SDK
jest.mock('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  EncryptCommand: jest.fn().mockImplementation((params) => params),
  DecryptCommand: jest.fn().mockImplementation((params) => params),
  DescribeKeyCommand: jest.fn().mockImplementation((params) => params),
}));

describe('Key Management Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('AWS KMS Implementation', () => {
    describe('encryptKey', () => {
      it('should encrypt a plaintext key successfully', async () => {
        const mockKmsClient = {
          send: jest.fn().mockResolvedValue({
            CiphertextBlob: Buffer.from('encrypted-data'),
            KeyId: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
          }),
        };

        // Mock the KMS client
        jest.doMock('@aws-sdk/client-kms', () => ({
          KMSClient: jest.fn().mockImplementation(() => mockKmsClient),
          EncryptCommand: jest.fn().mockImplementation((params) => params),
        }));

        const config = {
          backend: 'aws-kms' as const,
          keyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
        };

        const service = createKeyManagementService(config);
        const plaintext = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

        const result = await service.encryptKey(plaintext);

        expect(result).toHaveProperty('ciphertext');
        expect(result).toHaveProperty('keyVersion');
        expect(result).toHaveProperty('algorithm');
        expect(result).toHaveProperty('timestamp');
        expect(result.algorithm).toBe('AES-256-GCM');
      });

      it('should throw error if plaintext is empty', async () => {
        const config = {
          backend: 'aws-kms' as const,
          keyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
        };

        const service = createKeyManagementService(config);

        await expect(service.encryptKey('')).rejects.toThrow(KeyManagementError);
      });

      it('should retry on transient errors', async () => {
        const mockKmsClient = {
          send: jest
            .fn()
            .mockRejectedValueOnce(new Error('ThrottlingException'))
            .mockResolvedValueOnce({
              CiphertextBlob: Buffer.from('encrypted-data'),
              KeyId: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
            }),
        };

        jest.doMock('@aws-sdk/client-kms', () => ({
          KMSClient: jest.fn().mockImplementation(() => mockKmsClient),
          EncryptCommand: jest.fn().mockImplementation((params) => params),
        }));

        const config = {
          backend: 'aws-kms' as const,
          keyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
        };

        const service = createKeyManagementService(config);
        const plaintext = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

        const result = await service.encryptKey(plaintext);

        expect(result).toHaveProperty('ciphertext');
        expect(mockKmsClient.send).toHaveBeenCalledTimes(2);
      });

      it('should fail on permanent errors without retry', async () => {
        const mockKmsClient = {
          send: jest.fn().mockRejectedValue({
            name: 'AccessDeniedException',
            message: 'User is not authorized',
          }),
        };

        jest.doMock('@aws-sdk/client-kms', () => ({
          KMSClient: jest.fn().mockImplementation(() => mockKmsClient),
          EncryptCommand: jest.fn().mockImplementation((params) => params),
        }));

        const config = {
          backend: 'aws-kms' as const,
          keyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
        };

        const service = createKeyManagementService(config);
        const plaintext = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

        await expect(service.encryptKey(plaintext)).rejects.toThrow(KeyManagementError);
      });
    });

    describe('decryptKey', () => {
      it('should decrypt a ciphertext key successfully', async () => {
        const plaintext = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        const mockKmsClient = {
          send: jest.fn().mockResolvedValue({
            Plaintext: Buffer.from(plaintext, 'utf-8'),
          }),
        };

        jest.doMock('@aws-sdk/client-kms', () => ({
          KMSClient: jest.fn().mockImplementation(() => mockKmsClient),
          DecryptCommand: jest.fn().mockImplementation((params) => params),
        }));

        const config = {
          backend: 'aws-kms' as const,
          keyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
        };

        const service = createKeyManagementService(config);
        const encrypted: EncryptedKey = {
          ciphertext: Buffer.from('encrypted-data').toString('base64'),
          keyVersion: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
          algorithm: 'AES-256-GCM',
          timestamp: Date.now(),
        };

        const result = await service.decryptKey(encrypted);

        expect(result).toBe(plaintext);
      });

      it('should throw error if ciphertext is empty', async () => {
        const config = {
          backend: 'aws-kms' as const,
          keyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
        };

        const service = createKeyManagementService(config);
        const encrypted: EncryptedKey = {
          ciphertext: '',
          keyVersion: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
          algorithm: 'AES-256-GCM',
          timestamp: Date.now(),
        };

        await expect(service.decryptKey(encrypted)).rejects.toThrow(KeyManagementError);
      });

      it('should not log plaintext key material', async () => {
        const plaintext = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        const mockKmsClient = {
          send: jest.fn().mockResolvedValue({
            Plaintext: Buffer.from(plaintext, 'utf-8'),
          }),
        };

        jest.doMock('@aws-sdk/client-kms', () => ({
          KMSClient: jest.fn().mockImplementation(() => mockKmsClient),
          DecryptCommand: jest.fn().mockImplementation((params) => params),
        }));

        const config = {
          backend: 'aws-kms' as const,
          keyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
        };

        const service = createKeyManagementService(config);
        const encrypted: EncryptedKey = {
          ciphertext: Buffer.from('encrypted-data').toString('base64'),
          keyVersion: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
          algorithm: 'AES-256-GCM',
          timestamp: Date.now(),
        };

        // Mock logger to verify no plaintext is logged
        const loggerSpy = jest.spyOn(console, 'log').mockImplementation();

        await service.decryptKey(encrypted);

        // Verify plaintext was not logged
        const logCalls = loggerSpy.mock.calls.map((call) => call[0]?.toString() || '');
        expect(logCalls.join('')).not.toContain(plaintext);

        loggerSpy.mockRestore();
      });
    });

    describe('isHealthy', () => {
      it('should return true when KMS is healthy', async () => {
        const mockKmsClient = {
          send: jest.fn().mockResolvedValue({
            KeyMetadata: { KeyId: 'arn:aws:kms:us-east-1:123456789012:key/12345678' },
          }),
        };

        jest.doMock('@aws-sdk/client-kms', () => ({
          KMSClient: jest.fn().mockImplementation(() => mockKmsClient),
          DescribeKeyCommand: jest.fn().mockImplementation((params) => params),
        }));

        const config = {
          backend: 'aws-kms' as const,
          keyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
        };

        const service = createKeyManagementService(config);
        const result = await service.isHealthy();

        expect(result).toBe(true);
      });

      it('should return false when KMS is unavailable', async () => {
        const mockKmsClient = {
          send: jest.fn().mockRejectedValue(new Error('Connection refused')),
        };

        jest.doMock('@aws-sdk/client-kms', () => ({
          KMSClient: jest.fn().mockImplementation(() => mockKmsClient),
          DescribeKeyCommand: jest.fn().mockImplementation((params) => params),
        }));

        const config = {
          backend: 'aws-kms' as const,
          keyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
        };

        const service = createKeyManagementService(config);
        const result = await service.isHealthy();

        expect(result).toBe(false);
      });
    });
  });

  describe('Error Handling', () => {
    it('should create KeyManagementError with correct type', () => {
      const error = new KeyManagementError(
        KeyManagementErrorType.VAULT_UNAVAILABLE,
        'Vault is down'
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.type).toBe(KeyManagementErrorType.VAULT_UNAVAILABLE);
      expect(error.message).toBe('Vault is down');
    });

    it('should include details in error', () => {
      const details = { statusCode: 503 };
      const error = new KeyManagementError(
        KeyManagementErrorType.VAULT_UNAVAILABLE,
        'Vault is down',
        details
      );

      expect(error.details).toEqual(details);
    });

    it('should never include plaintext key in error message', () => {
      const plaintext = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const error = new KeyManagementError(
        KeyManagementErrorType.DECRYPTION_FAILED,
        'Failed to decrypt key'
      );

      expect(error.message).not.toContain(plaintext);
    });
  });

  describe('Service Initialization', () => {
    it('should throw error if service not initialized', () => {
      // Reset the singleton
      jest.resetModules();

      expect(() => {
        getKeyManagementService();
      }).toThrow(KeyManagementError);
    });

    it('should initialize service with AWS KMS config', () => {
      const config = {
        backend: 'aws-kms' as const,
        keyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
      };

      initializeKeyManagement(config);
      const service = getKeyManagementService();

      expect(service).toBeDefined();
    });
  });

  describe('Encrypt/Decrypt Round Trip', () => {
    it('should successfully encrypt and decrypt a key', async () => {
      const plaintext = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const mockKmsClient = {
        send: jest
          .fn()
          .mockResolvedValueOnce({
            CiphertextBlob: Buffer.from('encrypted-data'),
            KeyId: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
          })
          .mockResolvedValueOnce({
            Plaintext: Buffer.from(plaintext, 'utf-8'),
          }),
      };

      jest.doMock('@aws-sdk/client-kms', () => ({
        KMSClient: jest.fn().mockImplementation(() => mockKmsClient),
        EncryptCommand: jest.fn().mockImplementation((params) => params),
        DecryptCommand: jest.fn().mockImplementation((params) => params),
      }));

      const config = {
        backend: 'aws-kms' as const,
        keyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
      };

      const service = createKeyManagementService(config);

      // Encrypt
      const encrypted = await service.encryptKey(plaintext);

      // Decrypt
      const decrypted = await service.decryptKey(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });
});
