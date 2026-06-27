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

    expect(initializeKeyManagement).toHaveBeenCalledTimes(1);
    expect(mockKeyService.isHealthy).toHaveBeenCalled();
    expect(mockKeyService.rotateEncryptionKey).toHaveBeenCalled();
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

    expect(initializeKeyManagement).toHaveBeenCalledTimes(1);
  });
});
