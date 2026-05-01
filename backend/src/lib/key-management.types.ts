/**
 * Key Management Types and Interfaces
 * 
 * Defines error types and interfaces for encrypted key storage
 * backed by AWS KMS or HashiCorp Vault.
 */

export enum KeyManagementErrorType {
  /** Vault/KMS service is unavailable */
  VAULT_UNAVAILABLE = 'VAULT_UNAVAILABLE',
  /** Requested key not found in vault/KMS */
  KEY_NOT_FOUND = 'KEY_NOT_FOUND',
  /** Encryption operation failed */
  ENCRYPTION_FAILED = 'ENCRYPTION_FAILED',
  /** Decryption operation failed */
  DECRYPTION_FAILED = 'DECRYPTION_FAILED',
  /** Key format is invalid */
  INVALID_KEY_FORMAT = 'INVALID_KEY_FORMAT',
  /** Unauthorized access to vault/KMS */
  UNAUTHORIZED = 'UNAUTHORIZED',
  /** Configuration is invalid */
  INVALID_CONFIG = 'INVALID_CONFIG',
}

/**
 * Encrypted key with metadata
 * 
 * Security Note: This object contains ciphertext only, never plaintext key material.
 */
export interface EncryptedKey {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Key version used for encryption (for key rotation support) */
  keyVersion: string;
  /** Encryption algorithm used */
  algorithm: string;
  /** Timestamp when encrypted */
  timestamp: number;
}

/**
 * Key Management Error
 * 
 * Structured error type for key management operations.
 * Security Note: Error messages never contain plaintext key material.
 */
export class KeyManagementError extends Error {
  public type: KeyManagementErrorType;
  public details?: any;

  constructor(type: KeyManagementErrorType, message: string, details?: any) {
    super(message);
    this.name = 'KeyManagementError';
    this.type = type;
    this.details = details;
    // Ensure the error is properly recognized as an instance of Error
    Object.setPrototypeOf(this, KeyManagementError.prototype);
  }
}

/**
 * Key Management Service Interface
 * 
 * Single point of access for all key operations.
 * Implementations must never log or persist plaintext key material.
 */
export interface IKeyManagementService {
  /**
   * Encrypt a plaintext key value
   * 
   * @param plaintext - Plaintext key material (e.g., Stellar secret key)
   * @returns Encrypted key with metadata
   * @throws KeyManagementError if encryption fails
   * 
   * Security Note: Plaintext is never logged or persisted.
   */
  encryptKey(plaintext: string): Promise<EncryptedKey>;

  /**
   * Decrypt a ciphertext key value
   * 
   * @param encrypted - Encrypted key with metadata
   * @returns Plaintext key material (held in memory only)
   * @throws KeyManagementError if decryption fails
   * 
   * Security Note: Returned plaintext must be scoped to minimum lifetime.
   * Never store in cache, logs, or pass to logging functions.
   */
  decryptKey(encrypted: EncryptedKey): Promise<string>;

  /**
   * Get key by reference (for future key rotation)
   * 
   * @param keyRef - Key reference (e.g., key ID or vault path)
   * @returns Plaintext key material (held in memory only)
   * @throws KeyManagementError if key not found or retrieval fails
   * 
   * Security Note: Returned plaintext must be scoped to minimum lifetime.
   */
  getKeyByReference(keyRef: string): Promise<string>;

  /**
   * Health check for vault/KMS service
   * 
   * @returns true if service is healthy and accessible
   */
  isHealthy(): Promise<boolean>;
}

/**
 * AWS KMS Configuration
 */
export interface AwsKmsConfig {
  backend: 'aws-kms';
  keyArn: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * HashiCorp Vault Configuration
 */
export interface VaultConfig {
  backend: 'vault';
  address: string;
  token: string;
  transitPath: string;
}

/**
 * Key Management Configuration (union type)
 */
export type KeyManagementConfig = AwsKmsConfig | VaultConfig;
