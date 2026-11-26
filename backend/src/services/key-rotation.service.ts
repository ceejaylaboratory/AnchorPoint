import {
  buildKeyManagementConfigFromEnv,
  getKeyManagementService,
  initializeKeyManagement,
} from '../lib/key-management.service';
import { redis as cache } from '../lib/redis';
import {
  KeyManagementError,
  KeyManagementErrorType,
  KeyRotationResult,
} from '../lib/key-management.types';
import { config } from '../config/env';
import { randomBytes } from 'node:crypto';
import { storePreviousJwtSecret } from '../lib/jwt-key-state';
import configService from './config.service';
import { reencryptStoredDocuments } from './upload-store.service';
import logger from '../utils/logger';

const HOT_WALLET_KEYS_CACHE_KEY = 'hot_wallet_keys';

export interface JwtKeyRotationResult {
  rotated: true;
  rotatedAt: string;
  gracePeriodSeconds: number;
  previousKeyRetained: boolean;
}

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

    await cache.del(HOT_WALLET_KEYS_CACHE_KEY);
    this.refreshKeyMaterialInMemory();

    const reencryptedDocuments = await reencryptStoredDocuments();
    logger.info('Re-encrypted stored KYC documents after key rotation', {
      count: reencryptedDocuments,
    });

    logger.info('Automated key rotation completed', {
      backend: result.backend,
      rotated: result.rotated,
      keyVersion: result.keyVersion,
    });

    return result;
  }

  /**
   * Rotate the JWT signing key while keeping the previous key verifiable for
   * the configured grace period. New tokens are always signed with the new
   * primary secret (#1580).
   */
  async rotateJwtSigningKey(): Promise<JwtKeyRotationResult> {
    const currentSettings = configService.getConfig();
    const currentSecret = currentSettings.JWT_SECRET;
    const nextSecret = randomBytes(32).toString('hex');
    const gracePeriodSeconds = config.JWT_ROTATION_GRACE_PERIOD_SECONDS;

    if (!nextSecret || nextSecret === currentSecret) {
      throw new Error('Failed to generate a new JWT signing key');
    }

    await storePreviousJwtSecret(currentSecret, gracePeriodSeconds);
    await configService.updateConfig({
      ...currentSettings,
      JWT_SECRET: nextSecret,
    });

    logger.info('JWT signing key rotated', {
      grace_period_seconds: gracePeriodSeconds,
      previous_key_retained: gracePeriodSeconds > 0,
    });

    return {
      rotated: true,
      rotatedAt: new Date().toISOString(),
      gracePeriodSeconds,
      previousKeyRetained: gracePeriodSeconds > 0,
    };
  }

  private refreshKeyMaterialInMemory(): void {
    const keyConfig = buildKeyManagementConfigFromEnv(config);
    if (!keyConfig) {
      throw new KeyManagementError(
        KeyManagementErrorType.INVALID_CONFIG,
        'Key management is not configured. Set AWS_KMS_KEY_ARN or Vault credentials.'
      );
    }

    initializeKeyManagement(keyConfig);
  }
}
