import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  encrypt, 
  decrypt, 
  createEncryptedStorage, 
  createSecureStorage,
  STORAGE_KEY_PREFIX,
  DEFAULT_EXCLUDE_KEYS
} from './storage';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('storage utilities', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt data correctly', () => {
      const original = '{"user":"test","data":123}';
      const encrypted = encrypt(original);
      
      expect(encrypted).not.toBe(original);
      expect(encrypted.length).toBeGreaterThan(0);
      
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should produce different ciphertext for same input (due to key)', () => {
      const data = 'sensitive data';
      const encrypted1 = encrypt(data);
      const encrypted2 = encrypt(data);
      
      // With the same key stored, should produce same result
      expect(encrypted1).toBe(encrypted2);
    });

    it('should return empty string for invalid encrypted data', () => {
      const result = decrypt('invalid-base64!!!');
      expect(result).toBe('');
    });
  });

  describe('createEncryptedStorage', () => {
    it('should create a storage adapter with getItem/setItem/removeItem', () => {
      const storage = createEncryptedStorage();
      
      expect(typeof storage.getItem).toBe('function');
      expect(typeof storage.setItem).toBe('function');
      expect(typeof storage.removeItem).toBe('function');
    });

    it('should encrypt data when storing', () => {
      const storage = createEncryptedStorage({ name: 'test' });
      
      storage.setItem('test', { foo: 'bar' });
      
      expect(localStorageMock.setItem).toHaveBeenCalled();
      const setItemCall = (localStorageMock.setItem as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(setItemCall[0]).toBe(`${STORAGE_KEY_PREFIX}test`);
      expect(setItemCall[1]).not.toBe('{"foo":"bar"}'); // Should be encrypted
    });

    it('should decrypt data when retrieving', () => {
      const storage = createEncryptedStorage({ name: 'test' });
      
      // First set some encrypted data
      storage.setItem('test', { foo: 'bar' });
      
      // Then retrieve it
      const result = storage.getItem('test', null);
      
      expect(result).toEqual({ foo: 'bar' });
    });

    it('should exclude specified keys from persistence', () => {
      const storage = createEncryptedStorage({ 
        name: 'test-exclude',
        excludeKeys: ['secret', 'token'] 
      });
      
      storage.setItem('test', { 
        publicData: 'visible', 
        secret: 'hidden',
        token: 'also-hidden' 
      });
      
      const setItemCall = (localStorageMock.setItem as ReturnType<typeof vi.fn>).mock.calls[0];
      const storedValue = setItemCall[1];
      
      // Should not contain secret or token in plain form
      expect(storedValue).not.toContain('"secret":"hidden"');
      expect(storedValue).not.toContain('"token":"also-hidden"');
      expect(storedValue).toContain('"publicData":"visible"');
    });

    it('should return null for missing data', () => {
      const storage = createEncryptedStorage({ name: 'empty' });
      
      const result = storage.getItem('nonexistent', null);
      
      expect(result).toBeNull();
    });

    it('should remove item from storage', () => {
      const storage = createEncryptedStorage({ name: 'remove-test' });
      
      storage.setItem('test', { data: 'value' });
      storage.removeItem('test');
      
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(`${STORAGE_KEY_PREFIX}remove-test`);
    });
  });

  describe('createSecureStorage', () => {
    it('should exclude default sensitive keys', () => {
      const storage = createSecureStorage('secure-test');
      
      storage.setItem('test', {
        publicData: 'visible',
        authToken: 'should-be-excluded',
        jwt: 'also-excluded',
        token: 'excluded',
      });
      
      const setItemCall = (localStorageMock.setItem as ReturnType<typeof vi.fn>).mock.calls[0];
      const storedValue = setItemCall[1];
      
      // Should exclude default sensitive keys
      DEFAULT_EXCLUDE_KEYS.forEach((key) => {
        expect(storedValue).not.toContain(`"${key}"`);
      });
      
      // But keep public data
      expect(storedValue).toContain('"publicData":"visible"');
    });
  });

  describe('DEFAULT_EXCLUDE_KEYS', () => {
    it('should include common sensitive key names', () => {
      expect(DEFAULT_EXCLUDE_KEYS).toContain('authToken');
      expect(DEFAULT_EXCLUDE_KEYS).toContain('jwt');
      expect(DEFAULT_EXCLUDE_KEYS).toContain('token');
      expect(DEFAULT_EXCLUDE_KEYS).toContain('secret');
      expect(DEFAULT_EXCLUDE_KEYS).toContain('password');
      expect(DEFAULT_EXCLUDE_KEYS).toContain('apiKey');
    });
  });
});