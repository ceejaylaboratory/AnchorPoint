import {
  KeyManagementError,
  KeyManagementErrorType,
  EncryptedKey,
} from './key-management.types';
import { createKeyManagementService, initializeKeyManagement, getKeyManagementService } from './key-management.service';

const mockKmsSend = jest.fn();

jest.mock('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn().mockImplementation(() => ({ send: mockKmsSend })),
  EncryptCommand: jest.fn().mockImplementation((p) => p),
  DecryptCommand: jest.fn().mockImplementation((p) => p),
  DescribeKeyCommand: jest.fn().mockImplementation((p) => p),
  GetKeyRotationStatusCommand: jest.fn().mockImplementation((p) => p),
  EnableKeyRotationCommand: jest.fn().mockImplementation((p) => p),
}));

const KMS_CONFIG = {
  backend: 'aws-kms' as const,
  keyArn: 'arn:aws:kms:us-east-1:123456789012:key/12345678',
};

describe('Key Management Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('AWS KMS Implementation', () => {
    describe('encryptKey', () => {
      it('should encrypt a plaintext key successfully', async () => {
        mockKmsSend.mockResolvedValue({
          CiphertextBlob: Buffer.from('encrypted-data'),
          KeyId: KMS_CONFIG.keyArn,
        });

        const service = createKeyManagementService(KMS_CONFIG);
        const result = await service.encryptKey('SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

        expect(result).toHaveProperty('ciphertext');
        expect(result).toHaveProperty('keyVersion');
        expect(result.algorithm).toBe('AES-256-GCM');
      });

      it('should throw error if plaintext is empty', async () => {
        const service = createKeyManagementService(KMS_CONFIG);
        await expect(service.encryptKey('')).rejects.toThrow(KeyManagementError);
      });

      it('should retry on transient errors', async () => {
        const throttleErr = Object.assign(new Error('ThrottlingException'), { name: 'ThrottlingException' });
        mockKmsSend
          .mockRejectedValueOnce(throttleErr)
          .mockResolvedValueOnce({ CiphertextBlob: Buffer.from('encrypted-data'), KeyId: KMS_CONFIG.keyArn });

        const service = createKeyManagementService(KMS_CONFIG);
        const result = await service.encryptKey('SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

        expect(result).toHaveProperty('ciphertext');
        expect(mockKmsSend).toHaveBeenCalledTimes(2);
      });

      it('should fail on permanent errors without retry', async () => {
        mockKmsSend.mockRejectedValue(Object.assign(new Error('User is not authorized'), { name: 'AccessDeniedException' }));

        const service = createKeyManagementService(KMS_CONFIG);
        await expect(service.encryptKey('SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).rejects.toThrow(KeyManagementError);
        expect(mockKmsSend).toHaveBeenCalledTimes(1);
      });
    });

    describe('decryptKey', () => {
      const encrypted: EncryptedKey = {
        ciphertext: Buffer.from('encrypted-data').toString('base64'),
        keyVersion: KMS_CONFIG.keyArn,
        algorithm: 'AES-256-GCM',
        timestamp: Date.now(),
      };

      it('should decrypt a ciphertext key successfully', async () => {
        const plaintext = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        mockKmsSend.mockResolvedValue({ Plaintext: Buffer.from(plaintext, 'utf-8') });

        const service = createKeyManagementService(KMS_CONFIG);
        const result = await service.decryptKey(encrypted);

        expect(result).toBe(plaintext);
      });

      it('should throw error if ciphertext is empty', async () => {
        const service = createKeyManagementService(KMS_CONFIG);
        await expect(service.decryptKey({ ...encrypted, ciphertext: '' })).rejects.toThrow(KeyManagementError);
      });

      it('should not log plaintext key material', async () => {
        const plaintext = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        mockKmsSend.mockResolvedValue({ Plaintext: Buffer.from(plaintext, 'utf-8') });

        const service = createKeyManagementService(KMS_CONFIG);
        const logSpy = jest.spyOn(console, 'log').mockImplementation();

        await service.decryptKey(encrypted);

        const logged = logSpy.mock.calls.map((c) => String(c[0])).join('');
        expect(logged).not.toContain(plaintext);
        logSpy.mockRestore();
      });
    });

    describe('isHealthy', () => {
      it('should return true when KMS is healthy', async () => {
        mockKmsSend.mockResolvedValue({ KeyMetadata: { KeyId: KMS_CONFIG.keyArn } });

        const service = createKeyManagementService(KMS_CONFIG);
        expect(await service.isHealthy()).toBe(true);
      });

      it('should return false when KMS is unavailable', async () => {
        mockKmsSend.mockRejectedValue(new Error('Connection refused'));

        const service = createKeyManagementService(KMS_CONFIG);
        expect(await service.isHealthy()).toBe(false);
      });
    });

    describe('rotateEncryptionKey', () => {
      it('should enable rotation when not already enabled', async () => {
        mockKmsSend
          .mockResolvedValueOnce({ KeyRotationEnabled: false })
          .mockResolvedValueOnce({});

        const service = createKeyManagementService(KMS_CONFIG);
        const result = await service.rotateEncryptionKey();

        expect(result.rotated).toBe(true);
        expect(result.backend).toBe('aws-kms');
        expect(result.success).toBe(true);
      });

      it('should skip enable when rotation is already active', async () => {
        mockKmsSend.mockResolvedValue({ KeyRotationEnabled: true });

        const service = createKeyManagementService(KMS_CONFIG);
        const result = await service.rotateEncryptionKey();

        expect(result.rotated).toBe(false);
        expect(result.message).toContain('already enabled');
      });
    });
  });

  describe('Error Handling', () => {
    it('should create KeyManagementError with correct type', () => {
      const error = new KeyManagementError(KeyManagementErrorType.VAULT_UNAVAILABLE, 'Vault is down');
      expect(error).toBeInstanceOf(Error);
      expect(error.type).toBe(KeyManagementErrorType.VAULT_UNAVAILABLE);
    });

    it('should include details in error', () => {
      const details = { statusCode: 503 };
      const error = new KeyManagementError(KeyManagementErrorType.VAULT_UNAVAILABLE, 'Vault is down', details);
      expect(error.details).toEqual(details);
    });

    it('should never include plaintext key in error message', () => {
      const plaintext = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const error = new KeyManagementError(KeyManagementErrorType.DECRYPTION_FAILED, 'Failed to decrypt key');
      expect(error.message).not.toContain(plaintext);
    });
  });

  describe('Service Initialization', () => {
    it('should throw error if service not initialized', () => {
      jest.resetModules();
      expect(() => getKeyManagementService()).toThrow(KeyManagementError);
    });

    it('should initialize service with AWS KMS config', () => {
      initializeKeyManagement(KMS_CONFIG);
      expect(getKeyManagementService()).toBeDefined();
    });
  });

  describe('Encrypt/Decrypt Round Trip', () => {
    it('should successfully encrypt and decrypt a key', async () => {
      const plaintext = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      mockKmsSend
        .mockResolvedValueOnce({ CiphertextBlob: Buffer.from('encrypted-data'), KeyId: KMS_CONFIG.keyArn })
        .mockResolvedValueOnce({ Plaintext: Buffer.from(plaintext, 'utf-8') });

      const service = createKeyManagementService(KMS_CONFIG);
      const encrypted = await service.encryptKey(plaintext);
      const decrypted = await service.decryptKey(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });
});

describe('Vault Transit Fallback (#370)', () => {
  const FALLBACK_KEY = 'a'.repeat(64);
  const vaultConfig = {
    backend: 'vault' as const,
    address: 'http://vault:8200',
    token: 'test-token',
    transitPath: 'transit',
  };

  beforeEach(() => {
    process.env.VAULT_FALLBACK_KEY = FALLBACK_KEY;
  });

  afterEach(() => {
    delete process.env.VAULT_FALLBACK_KEY;
    jest.resetModules();
  });

  it('falls back to local AES-256-GCM when Vault is unreachable on encrypt', async () => {
    jest.mock('node-vault', () =>
      jest.fn().mockImplementation(() => ({
        write: jest.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
      }))
    );

    const { createKeyManagementService: create } = await import('./key-management.service');
    const service = create(vaultConfig);
    const result = await service.encryptKey('secret-key');

    expect(result.keyVersion).toBe('local');
    expect(result.ciphertext).toMatch(/^local:/);
  });

  it('decrypts a locally-encrypted ciphertext without contacting Vault', async () => {
    jest.mock('node-vault', () =>
      jest.fn().mockImplementation(() => ({
        write: jest.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
      }))
    );

    const { createKeyManagementService: create } = await import('./key-management.service');
    const service = create(vaultConfig);

    const plaintext = 'my-stellar-secret';
    const encrypted = await service.encryptKey(plaintext);
    const decrypted = await service.decryptKey(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it('does not fall back when VAULT_FALLBACK_KEY is absent', async () => {
    delete process.env.VAULT_FALLBACK_KEY;

    jest.mock('node-vault', () =>
      jest.fn().mockImplementation(() => ({
        write: jest.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
      }))
    );

    const { createKeyManagementService: create } = await import('./key-management.service');
    const service = create(vaultConfig);

    await expect(service.encryptKey('secret')).rejects.toThrow();
  });
});
