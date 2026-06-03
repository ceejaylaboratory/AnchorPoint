import {
  buildKeyManagementConfigFromEnv,
  getKeyManagementService,
  initializeKeyManagement,
} from '../lib/key-management.service';
import {
  KeyManagementError,
  KeyManagementErrorType,
  KeyRotationResult,
} from '../lib/key-management.types';
import { config } from '../config/env';
import logger from '../utils/logger';

/**
 * Service for automated encryption key rotation.
 * Delegates to the configured vault/KMS backend without exposing key material.
 */
export class KeyRotationService {
  private initialized = false;

  /**
   * Initialize the key management backend from environment configuration.
   */
  ensureInitialized(): void {
    if (this.initialized) {
      return;
    }

    const keyConfig = buildKeyManagementConfigFromEnv(config);
    if (!keyConfig) {
      throw new KeyManagementError(
        KeyManagementErrorType.INVALID_CONFIG,
        'Key management is not configured. Set AWS_KMS_KEY_ARN or Vault credentials.'
      );
    }

    initializeKeyManagement(keyConfig);
    this.initialized = true;
  }

  /**
   * Run a key rotation cycle: health check, then rotate at the backend.
   */
  async rotateKeys(): Promise<KeyRotationResult> {
    this.ensureInitialized();

    const keyManagementService = getKeyManagementService();
    const healthy = await keyManagementService.isHealthy();

    if (!healthy) {
      throw new KeyManagementError(
        KeyManagementErrorType.VAULT_UNAVAILABLE,
        'Key management backend is unavailable; skipping rotation'
      );
    }

    logger.info('Starting automated key rotation');
    const result = await keyManagementService.rotateEncryptionKey();

    logger.info('Automated key rotation completed', {
      backend: result.backend,
      rotated: result.rotated,
      keyVersion: result.keyVersion,
    });

    return result;
  }
}
