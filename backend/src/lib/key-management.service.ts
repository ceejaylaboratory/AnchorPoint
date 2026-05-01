/**
 * Key Management Service
 * 
 * Handles encryption and decryption of provider private keys using AWS KMS or HashiCorp Vault.
 * This is the single point of access for all key operations.
 * 
 * Security Guarantees:
 * - Plaintext key material is never logged at any level
 * - Plaintext key material is never included in error messages
 * - Plaintext key material is never written to files or database
 * - Decrypted keys are held in memory only, scoped to operation lifetime
 */

import logger from '../utils/logger';
import {
  KeyManagementError,
  KeyManagementErrorType,
  EncryptedKey,
  IKeyManagementService,
  AwsKmsConfig,
  VaultConfig,
  KeyManagementConfig,
} from './key-management.types';

/**
 * AWS KMS Implementation
 */
class AwsKmsService implements IKeyManagementService {
  private kmsClient: any;
  private keyArn: string;
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 100;

  constructor(config: AwsKmsConfig) {
    this.keyArn = config.keyArn;

    // Lazy load AWS SDK to avoid dependency if not using AWS KMS
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { KMSClient } = require('@aws-sdk/client-kms');
      this.kmsClient = new KMSClient({
        region: config.region || process.env.AWS_REGION || 'us-east-1',
        credentials: config.accessKeyId
          ? {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey || '',
            }
          : undefined,
      });
    } catch (error) {
      throw new KeyManagementError(
        KeyManagementErrorType.INVALID_CONFIG,
        'AWS SDK not installed. Install @aws-sdk/client-kms to use AWS KMS backend.'
      );
    }
  }

  /**
   * Encrypt a plaintext key using AWS KMS
   * 
   * Security Note: Plaintext is never logged or persisted.
   */
  async encryptKey(plaintext: string): Promise<EncryptedKey> {
    if (!plaintext) {
      throw new KeyManagementError(
        KeyManagementErrorType.INVALID_KEY_FORMAT,
        'Plaintext key cannot be empty'
      );
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { EncryptCommand } = require('@aws-sdk/client-kms');

        const command = new EncryptCommand({
          KeyId: this.keyArn,
          Plaintext: Buffer.from(plaintext, 'utf-8'),
        });

        const response = await this.kmsClient.send(command);

        // Convert ciphertext to base64 for storage
        const ciphertext = Buffer.from(response.CiphertextBlob).toString('base64');

        logger.debug('Key encrypted successfully via AWS KMS');

        return {
          ciphertext,
          keyVersion: response.KeyId || this.keyArn,
          algorithm: 'AES-256-GCM',
          timestamp: Date.now(),
        };
      } catch (error: any) {
        lastError = error;

        // Check if error is transient
        const isTransient =
          error.name === 'ThrottlingException' ||
          error.name === 'RequestLimitExceededException' ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'ETIMEDOUT';

        if (isTransient && attempt < this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
          logger.debug(`KMS encryption transient error, retrying in ${delay}ms`);
          await this.delay(delay);
          continue;
        }

        // Permanent error or final attempt
        break;
      }
    }

    // Determine error type
    let errorType = KeyManagementErrorType.ENCRYPTION_FAILED;
    if (lastError?.name === 'AccessDeniedException') {
      errorType = KeyManagementErrorType.UNAUTHORIZED;
    } else if (lastError?.name === 'NotFoundException') {
      errorType = KeyManagementErrorType.KEY_NOT_FOUND;
    }

    throw new KeyManagementError(
      errorType,
      `Failed to encrypt key via AWS KMS after ${this.maxRetries} attempts`,
      { originalError: lastError?.message }
    );
  }

  /**
   * Decrypt a ciphertext key using AWS KMS
   * 
   * Security Note: Returned plaintext must be scoped to minimum lifetime.
   * Never store in cache, logs, or pass to logging functions.
   */
  async decryptKey(encrypted: EncryptedKey): Promise<string> {
    if (!encrypted.ciphertext) {
      throw new KeyManagementError(
        KeyManagementErrorType.INVALID_KEY_FORMAT,
        'Encrypted key ciphertext cannot be empty'
      );
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { DecryptCommand } = require('@aws-sdk/client-kms');

        const ciphertextBuffer = Buffer.from(encrypted.ciphertext, 'base64');

        const command = new DecryptCommand({
          CiphertextBlob: ciphertextBuffer,
        });

        const response = await this.kmsClient.send(command);

        // Convert plaintext buffer to string
        const plaintext = Buffer.from(response.Plaintext).toString('utf-8');

        logger.debug('Key decrypted successfully via AWS KMS');

        return plaintext;
      } catch (error: any) {
        lastError = error;

        // Check if error is transient
        const isTransient =
          error.name === 'ThrottlingException' ||
          error.name === 'RequestLimitExceededException' ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'ETIMEDOUT';

        if (isTransient && attempt < this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
          logger.debug(`KMS decryption transient error, retrying in ${delay}ms`);
          await this.delay(delay);
          continue;
        }

        // Permanent error or final attempt
        break;
      }
    }

    // Determine error type
    let errorType = KeyManagementErrorType.DECRYPTION_FAILED;
    if (lastError?.name === 'AccessDeniedException') {
      errorType = KeyManagementErrorType.UNAUTHORIZED;
    } else if (lastError?.name === 'InvalidCiphertextException') {
      errorType = KeyManagementErrorType.INVALID_KEY_FORMAT;
    }

    throw new KeyManagementError(
      errorType,
      `Failed to decrypt key via AWS KMS after ${this.maxRetries} attempts`,
      { originalError: lastError?.message }
    );
  }

  /**
   * Get key by reference (for future key rotation)
   * 
   * Currently not implemented for AWS KMS; keys are retrieved via decryption.
   */
  async getKeyByReference(keyRef: string): Promise<string> {
    throw new KeyManagementError(
      KeyManagementErrorType.INVALID_CONFIG,
      'getKeyByReference is not supported for AWS KMS backend'
    );
  }

  /**
   * Health check for AWS KMS
   */
  async isHealthy(): Promise<boolean> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { DescribeKeyCommand } = require('@aws-sdk/client-kms');

      const command = new DescribeKeyCommand({
        KeyId: this.keyArn,
      });

      await this.kmsClient.send(command);
      return true;
    } catch (error) {
      logger.error(`KMS health check failed: ${error}`);
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * HashiCorp Vault Implementation
 */
class VaultService implements IKeyManagementService {
  private vaultClient: any;
  private transitPath: string;
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 100;

  constructor(config: VaultConfig) {
    this.transitPath = config.transitPath;

    // Lazy load Vault client
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const VaultClient = require('node-vault');
      this.vaultClient = new VaultClient({
        endpoint: config.address,
        token: config.token,
      });
    } catch (error) {
      throw new KeyManagementError(
        KeyManagementErrorType.INVALID_CONFIG,
        'Vault client not installed. Install node-vault to use Vault backend.'
      );
    }
  }

  /**
   * Encrypt a plaintext key using Vault Transit engine
   * 
   * Security Note: Plaintext is never logged or persisted.
   */
  async encryptKey(plaintext: string): Promise<EncryptedKey> {
    if (!plaintext) {
      throw new KeyManagementError(
        KeyManagementErrorType.INVALID_KEY_FORMAT,
        'Plaintext key cannot be empty'
      );
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.vaultClient.write(
          `${this.transitPath}/encrypt/stellar-keys`,
          {
            plaintext: Buffer.from(plaintext, 'utf-8').toString('base64'),
          }
        );

        logger.debug('Key encrypted successfully via Vault');

        return {
          ciphertext: response.data.ciphertext,
          keyVersion: response.data.key_version?.toString() || '1',
          algorithm: 'AES-256-GCM',
          timestamp: Date.now(),
        };
      } catch (error: any) {
        lastError = error;

        // Check if error is transient
        const isTransient =
          error.statusCode === 429 ||
          error.statusCode === 503 ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'ETIMEDOUT';

        if (isTransient && attempt < this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
          logger.debug(`Vault encryption transient error, retrying in ${delay}ms`);
          await this.delay(delay);
          continue;
        }

        // Permanent error or final attempt
        break;
      }
    }

    // Determine error type
    let errorType = KeyManagementErrorType.ENCRYPTION_FAILED;
    if (lastError?.statusCode === 403) {
      errorType = KeyManagementErrorType.UNAUTHORIZED;
    } else if (lastError?.statusCode === 404) {
      errorType = KeyManagementErrorType.KEY_NOT_FOUND;
    }

    throw new KeyManagementError(
      errorType,
      `Failed to encrypt key via Vault after ${this.maxRetries} attempts`,
      { originalError: lastError?.message }
    );
  }

  /**
   * Decrypt a ciphertext key using Vault Transit engine
   * 
   * Security Note: Returned plaintext must be scoped to minimum lifetime.
   * Never store in cache, logs, or pass to logging functions.
   */
  async decryptKey(encrypted: EncryptedKey): Promise<string> {
    if (!encrypted.ciphertext) {
      throw new KeyManagementError(
        KeyManagementErrorType.INVALID_KEY_FORMAT,
        'Encrypted key ciphertext cannot be empty'
      );
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.vaultClient.write(
          `${this.transitPath}/decrypt/stellar-keys`,
          {
            ciphertext: encrypted.ciphertext,
          }
        );

        const plaintext = Buffer.from(response.data.plaintext, 'base64').toString('utf-8');

        logger.debug('Key decrypted successfully via Vault');

        return plaintext;
      } catch (error: any) {
        lastError = error;

        // Check if error is transient
        const isTransient =
          error.statusCode === 429 ||
          error.statusCode === 503 ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'ETIMEDOUT';

        if (isTransient && attempt < this.maxRetries) {
          const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
          logger.debug(`Vault decryption transient error, retrying in ${delay}ms`);
          await this.delay(delay);
          continue;
        }

        // Permanent error or final attempt
        break;
      }
    }

    // Determine error type
    let errorType = KeyManagementErrorType.DECRYPTION_FAILED;
    if (lastError?.statusCode === 403) {
      errorType = KeyManagementErrorType.UNAUTHORIZED;
    } else if (lastError?.statusCode === 400) {
      errorType = KeyManagementErrorType.INVALID_KEY_FORMAT;
    }

    throw new KeyManagementError(
      errorType,
      `Failed to decrypt key via Vault after ${this.maxRetries} attempts`,
      { originalError: lastError?.message }
    );
  }

  /**
   * Get key by reference from Vault KV store
   */
  async getKeyByReference(keyRef: string): Promise<string> {
    try {
      const response = await this.vaultClient.read(`secret/data/${keyRef}`);
      return response.data.data.key;
    } catch (error: any) {
      if (error.statusCode === 404) {
        throw new KeyManagementError(
          KeyManagementErrorType.KEY_NOT_FOUND,
          `Key not found in Vault: ${keyRef}`
        );
      }
      throw new KeyManagementError(
        KeyManagementErrorType.VAULT_UNAVAILABLE,
        `Failed to retrieve key from Vault: ${error.message}`
      );
    }
  }

  /**
   * Health check for Vault
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.vaultClient.health();
      return true;
    } catch (error) {
      logger.error(`Vault health check failed: ${error}`);
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create appropriate key management service
 */
export function createKeyManagementService(config: KeyManagementConfig): IKeyManagementService {
  if (config.backend === 'aws-kms') {
    return new AwsKmsService(config);
  } else if (config.backend === 'vault') {
    return new VaultService(config);
  }

  throw new KeyManagementError(
    KeyManagementErrorType.INVALID_CONFIG,
    `Unknown key management backend: ${(config as any).backend}`
  );
}

/**
 * Singleton instance of key management service
 */
let keyManagementServiceInstance: IKeyManagementService | null = null;

/**
 * Get or create the key management service singleton
 */
export function getKeyManagementService(): IKeyManagementService {
  if (!keyManagementServiceInstance) {
    throw new KeyManagementError(
      KeyManagementErrorType.INVALID_CONFIG,
      'Key management service not initialized. Call initializeKeyManagement() first.'
    );
  }
  return keyManagementServiceInstance;
}

/**
 * Initialize the key management service
 * 
 * Must be called during application startup before any key operations.
 */
export function initializeKeyManagement(config: KeyManagementConfig): void {
  keyManagementServiceInstance = createKeyManagementService(config);
  logger.info(`Key management service initialized with backend: ${config.backend}`);
}
