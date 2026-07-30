import {
  KeyManagementError,
  KeyManagementErrorType,
} from '../lib/key-management.types';
import { KeyRotationService } from './key-rotation.service';

jest.mock('../lib/key-management.service', () => ({
  buildKeyManagementConfigFromEnv: jest.fn(),
  initializeKeyManagement: jest.fn(),
  getKeyManagementService: jest.fn(),
}));

jest.mock('../lib/redis', () => ({
  redis: {
    del: jest.fn(),
  },
}));
import { redis } from '../lib/redis';
const mockCacheDel = redis.del as jest.Mock;

jest.mock('../config/env', () => ({
  config: {
    KEY_MANAGEMENT_BACKEND: 'aws-kms',
    AWS_KMS_KEY_ARN: 'arn:aws:kms:us-east-1:123456789012:key/test',
  },
}));

const {
  buildKeyManagementConfigFromEnv,
  initializeKeyManagement,
  getKeyManagementService,
} = jest.requireMock('../lib/key-management.service');

describe('KeyRotationService', () => {
  let service: KeyRotationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheDel.mockResolvedValue(1);
    service = new KeyRotationService();
  });

  it('throws when key management is not configured', async () => {
    buildKeyManagementConfigFromEnv.mockReturnValue(null);

    await expect(service.rotateKeys()).rejects.toMatchObject({
      type: KeyManagementErrorType.INVALID_CONFIG,
    });
  });

  it('throws when backend health check fails', async () => {
    buildKeyManagementConfigFromEnv.mockReturnValue({
      backend: 'aws-kms',
      keyArn: 'arn:aws:kms:us-east-1:123456789012:key/test',
    });

    getKeyManagementService.mockReturnValue({
      isHealthy: jest.fn().mockResolvedValue(false),
      rotateEncryptionKey: jest.fn(),
    });

    await expect(service.rotateKeys()).rejects.toMatchObject({
      type: KeyManagementErrorType.VAULT_UNAVAILABLE,
    });
  });

  it('delegates rotation to the key management service', async () => {
    const rotationResult = {
      success: true,
      backend: 'vault' as const,
      rotated: true,
      keyVersion: '3',
      message: 'Transit key rotated to version 3',
      timestamp: Date.now(),
    };

    buildKeyManagementConfigFromEnv.mockReturnValue({
      backend: 'vault',
      address: 'https://vault.example.com',
      token: 's.test',
      transitPath: 'transit',
    });

    const mockKeyService = {
      isHealthy: jest.fn().mockResolvedValue(true),
      rotateEncryptionKey: jest.fn().mockResolvedValue(rotationResult),
    };

    getKeyManagementService.mockReturnValue(mockKeyService);

    const result = await service.rotateKeys();

    expect(initializeKeyManagement).toHaveBeenCalledTimes(2);
    expect(mockKeyService.isHealthy).toHaveBeenCalled();
    expect(mockKeyService.rotateEncryptionKey).toHaveBeenCalled();
    expect(mockCacheDel).toHaveBeenCalledWith('hot_wallet_keys');
    expect(result).toEqual(rotationResult);
  });

  it('initializes key management only once across multiple calls', async () => {
    buildKeyManagementConfigFromEnv.mockReturnValue({
      backend: 'aws-kms',
      keyArn: 'arn:aws:kms:us-east-1:123456789012:key/test',
    });

    const mockKeyService = {
      isHealthy: jest.fn().mockResolvedValue(true),
      rotateEncryptionKey: jest.fn().mockResolvedValue({
        success: true,
        backend: 'aws-kms',
        rotated: false,
        message: 'Automatic key rotation already enabled',
        timestamp: Date.now(),
      }),
    };

    getKeyManagementService.mockReturnValue(mockKeyService);

    await service.rotateKeys();
    await service.rotateKeys();

    expect(initializeKeyManagement).toHaveBeenCalledTimes(3);
  });

  it('evicts old hot wallet public keys after successful rotation', async () => {
    const cacheState = new Map<string, string>([['hot_wallet_keys', 'GOLD_PUBLIC_KEY']]);
    mockCacheDel.mockImplementation(async (key: string) => {
      const existed = cacheState.delete(key);
      return existed ? 1 : 0;
    });

    buildKeyManagementConfigFromEnv.mockReturnValue({
      backend: 'aws-kms',
      keyArn: 'arn:aws:kms:us-east-1:123456789012:key/test',
    });

    getKeyManagementService.mockReturnValue({
      isHealthy: jest.fn().mockResolvedValue(true),
      rotateEncryptionKey: jest.fn().mockResolvedValue({
        success: true,
        backend: 'aws-kms',
        rotated: true,
        keyVersion: '2',
        message: 'Automatic key rotation enabled',
        timestamp: Date.now(),
      }),
    });

    await service.rotateKeys();

    expect(cacheState.has('hot_wallet_keys')).toBe(false);
  });
});
