/**
 * Encrypted storage utilities for Zustand persist middleware
 * Provides basic encryption for sensitive data stored in localStorage
 */

// Simple encryption key - in production, this should be derived from user credentials
// or fetched from a secure key management service
const STORAGE_KEY_PREFIX = 'anchorpoint_';

/**
 * Simple XOR-based encryption for localStorage data
 * Note: This is a basic implementation for demonstration.
 * In production, use Web Crypto API or a proper encryption library like 'crypto-js'
 */
const encrypt = (data: string): string => {
  const key = getEncryptionKey();
  let result = '';
  for (let i = 0; i < data.length; i++) {
    result += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(result);
};

/**
 * Decrypts data encrypted with the encrypt function
 */
const decrypt = (data: string): string => {
  try {
    const key = getEncryptionKey();
    const decoded = atob(data);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  } catch {
    console.warn('Failed to decrypt data, returning empty state');
    return '';
  }
};

/**
 * Gets or generates the encryption key
 * In production, this should be a persistent key derived from user credentials
 */
const getEncryptionKey = (): string => {
  const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}enc_key`);
  if (stored) return stored;
  
  // Generate a random key (in production, use Web Crypto API)
  const key = Math.random().toString(36).substring(2) + Date.now().toString(36);
  localStorage.setItem(`${STORAGE_KEY_PREFIX}enc_key`, key);
  return key;
};

/**
 * Zustand storage adapter with encryption
 */
export const createEncryptedStorage = <T>(
  options?: {
    /** Keys that should NOT be persisted (sensitive data like JWT tokens) */
    excludeKeys?: string[];
    /** Name for the storage (used in localStorage key) */
    name?: string;
  }
) => {
  const { excludeKeys = [], name = 'app-storage' } = options || {};
  const storageKey = `${STORAGE_KEY_PREFIX}${name}`;

  return {
    getItem: (_name: string, state: T | null): T | null => {
      try {
        const value = localStorage.getItem(storageKey);
        if (!value) return null;
        
        const decrypted = decrypt(value);
        return JSON.parse(decrypted) as T;
      } catch (err) {
        console.warn('Failed to read from encrypted storage:', err);
        return null;
      }
    },

    setItem: (_name: string, value: T): void => {
      try {
        // Filter out sensitive keys before persistence
        let valueToStore = value;
        if (excludeKeys.length > 0 && typeof value === 'object' && value !== null) {
          const filtered = { ...value } as Record<string, unknown>;
          excludeKeys.forEach((key) => {
            delete filtered[key];
          });
          valueToStore = filtered as T;
        }

        const serialized = JSON.stringify(valueToStore);
        const encrypted = encrypt(serialized);
        localStorage.setItem(storageKey, encrypted);
      } catch (err) {
        console.error('Failed to write to encrypted storage:', err);
      }
    },

    removeItem: (_name: string): void => {
      localStorage.removeItem(storageKey);
    },
  };
};

/**
 * Default exclusions for sensitive data that should never be in plain localStorage
 */
export const DEFAULT_EXCLUDE_KEYS = ['authToken', 'jwt', 'token', 'secret', 'password', 'apiKey'];

/**
 * Creates a storage adapter that explicitly excludes sensitive keys
 * while encrypting everything else
 */
export const createSecureStorage = (name?: string) => 
  createEncryptedStorage({
    excludeKeys: DEFAULT_EXCLUDE_KEYS,
    name,
  });

export { STORAGE_KEY_PREFIX };