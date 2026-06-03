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
  KeyRotationResult,
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

  /**
   * Ensure automatic key rotation is enabled for the AWS KMS key.
   * AWS rotates symmetric CMKs annually once enabled; old versions remain decryptable.
   */
  async rotateEncryptionKey(): Promise<KeyRotationResult> {
    const timestamp = Date.now();

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { GetKeyRotationStatusCommand, EnableKeyRotationCommand } = require('@aws-sdk/client-kms');

      const statusCommand = new GetKeyRotationStatusCommand({ KeyId: this.keyArn });
      const statusResponse = await this.kmsClient.send(statusCommand);

      if (statusResponse.KeyRotationEnabled) {
        logger.info('AWS KMS automatic key rotation is already enabled');
        return {
          success: true,
          backend: 'aws-kms',
          rotated: false,
          keyVersion: this.keyArn,
          message: 'Automatic key rotation already enabled',
          timestamp,
        };
      }

      const enableCommand = new EnableKeyRotationCommand({ KeyId: this.keyArn });
      await this.kmsClient.send(enableCommand);

      logger.info('AWS KMS automatic key rotation enabled successfully');

      return {
        success: true,
        backend: 'aws-kms',
        rotated: true,
        keyVersion: this.keyArn,
        message: 'Automatic key rotation enabled',
        timestamp,
      };
    } catch (error: any) {
      logger.error(`AWS KMS key rotation failed: ${error?.name ?? error?.message ?? error}`);

      throw new KeyManagementError(
        KeyManagementErrorType.ENCRYPTION_FAILED,
        'Failed to configure AWS KMS key rotation',
        { originalError: error?.message }
      );
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

  /**
   * Rotate the Vault Transit engine encryption key to a new version.
   * Previous versions remain available for decryption.
   */
  async rotateEncryptionKey(): Promise<KeyRotationResult> {
    const timestamp = Date.now();

    try {
      const response = await this.vaultClient.write(
        `${this.transitPath}/keys/stellar-keys/rotate`
      );

      const keyVersion = response.data?.latest_version?.toString() ?? 'unknown';

      logger.info(`Vault Transit key rotated successfully (version ${keyVersion})`);

      return {
        success: true,
        backend: 'vault',
        rotated: true,
        keyVersion,
        message: `Transit key rotated to version ${keyVersion}`,
        timestamp,
      };
    } catch (error: any) {
      logger.error(`Vault key rotation failed: ${error?.message ?? error}`);

      let errorType = KeyManagementErrorType.ENCRYPTION_FAILED;
      if (error?.statusCode === 403) {
        errorType = KeyManagementErrorType.UNAUTHORIZED;
      } else if (error?.statusCode === 404) {
        errorType = KeyManagementErrorType.KEY_NOT_FOUND;
      }

      throw new KeyManagementError(
        errorType,
        'Failed to rotate Vault Transit encryption key',
        { originalError: error?.message }
      );
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

/**
 * Validate AWS KMS / Vault configuration at startup and emit structured
 * diagnostic log entries.  Never throws — missing config is surfaced as a
 * warning so the process can still start and serve non-key-management routes.
 */
export function validateKmsConfigOnStartup(envConfig: {
  KEY_MANAGEMENT_BACKEND?: string;
  AWS_KMS_KEY_ARN?: string;
  AWS_REGION?: string;
  VAULT_ADDR?: string;
  VAULT_TOKEN?: string;
  VAULT_TRANSIT_PATH?: string;
}): void {
  const backend = envConfig.KEY_MANAGEMENT_BACKEND ?? 'aws-kms';

  if (backend === 'aws-kms') {
    if (!envConfig.AWS_KMS_KEY_ARN) {
      logger.warn('KMS startup validation: KEY_MANAGEMENT_BACKEND=aws-kms but AWS_KMS_KEY_ARN is not set — key encryption/decryption unavailable', {
        backend,
        missingVars: ['AWS_KMS_KEY_ARN'],
      });
    } else {
      const maskedArn = envConfig.AWS_KMS_KEY_ARN.replace(/(?<=.{20}).+(?=.{6})/, '***');
      logger.info('KMS startup validation: AWS KMS configuration present', {
        backend,
        keyArn: maskedArn,
        region: envConfig.AWS_REGION ?? 'us-east-1 (default)',
      });
    }
    return;
  }

  if (backend === 'vault') {
    const missingVars: string[] = [];
    if (!envConfig.VAULT_ADDR) missingVars.push('VAULT_ADDR');
    if (!envConfig.VAULT_TOKEN) missingVars.push('VAULT_TOKEN');
    if (!envConfig.VAULT_TRANSIT_PATH) missingVars.push('VAULT_TRANSIT_PATH');

    if (missingVars.length > 0) {
      logger.warn('KMS startup validation: KEY_MANAGEMENT_BACKEND=vault but required vars are missing — key encryption/decryption unavailable', {
        backend,
        missingVars,
      });
    } else {
      logger.info('KMS startup validation: HashiCorp Vault configuration present', {
        backend,
        vaultAddr: envConfig.VAULT_ADDR,
        transitPath: envConfig.VAULT_TRANSIT_PATH,
      });
    }
    return;
  }

  logger.warn('KMS startup validation: unrecognised KEY_MANAGEMENT_BACKEND value', { backend });
}

/**
 * Build key management configuration from environment variables.
 * Returns null when required credentials are missing.
 */
export function buildKeyManagementConfigFromEnv(env: {
  KEY_MANAGEMENT_BACKEND: 'aws-kms' | 'vault';
  AWS_KMS_KEY_ARN?: string;
  AWS_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  VAULT_ADDR?: string;
  VAULT_TOKEN?: string;
  VAULT_TRANSIT_PATH?: string;
}): KeyManagementConfig | null {
  if (env.KEY_MANAGEMENT_BACKEND === 'aws-kms') {
    if (!env.AWS_KMS_KEY_ARN) {
      return null;
    }
    return {
      backend: 'aws-kms',
      keyArn: env.AWS_KMS_KEY_ARN,
      region: env.AWS_REGION,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    };
  }

  if (!env.VAULT_ADDR || !env.VAULT_TOKEN || !env.VAULT_TRANSIT_PATH) {
    return null;
  }

  return {
    backend: 'vault',
    address: env.VAULT_ADDR,
    token: env.VAULT_TOKEN,
    transitPath: env.VAULT_TRANSIT_PATH,
  };
}
