import crypto from 'crypto';

/**
 * AES-256-GCM Encryption Service
 * Secures PII data at rest.
 */
export class CryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor() {
    // In production, ENCRYPTION_KEY should be a 32-byte string from a KMS or secure vault.
    // For local dev/testing, we fallback to a hardcoded 32-byte key.
    const keyString = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';
    if (keyString.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be exactly 32 bytes long');
    }
    this.key = Buffer.from(keyString, 'utf8');
  }

  /**
   * Encrypts a string and returns the encrypted string along with the Initialization Vector (IV).
   * The auth tag is appended to the encrypted string.
   */
  encrypt(text: string): { encryptedData: string; iv: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    return {
      encryptedData: encrypted + ':' + authTag,
      iv: iv.toString('hex')
    };
  }

  /**
   * Decrypts a string using the provided Initialization Vector (IV).
   */
  decrypt(encryptedDataWithTag: string, ivHex: string): string {
    const [encryptedText, authTagHex] = encryptedDataWithTag.split(':');
    if (!encryptedText || !authTagHex) {
      throw new Error('Invalid encrypted data format. Expected encryptedText:authTag');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

export const cryptoService = new CryptoService();
