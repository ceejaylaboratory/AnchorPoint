import crypto from 'crypto';

/**
 * AES-256-GCM Encryption Service
 * Secures PII data at rest.
 *
 * Encrypted payload format (stored as a single string):
 *   <hexIV>:<hexCiphertext>:<hexAuthTag>
 *
 * This self-contained format lets the middleware store everything in one
 * database column without needing separate IV/tag columns.
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
   *
   * @returns `{ encryptedData: "<hex_ciphertext>:<hex_authTag>", iv: "<hex_iv>" }`
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

  /**
   * Encrypts a plain-text value into a self-contained string:
   *   `<hexIV>:<hexCiphertext>:<hexAuthTag>`
   *
   * Use this variant for storing PII in a single database column.
   */
  encryptPii(plaintext: string): string {
    const { encryptedData, iv } = this.encrypt(plaintext);
    return `${iv}:${encryptedData}`;
  }

  /**
   * Decrypts a self-contained PII payload produced by `encryptPii`.
   * Expected format: `<hexIV>:<hexCiphertext>:<hexAuthTag>`
   */
  decryptPii(payload: string): string {
    // format: <iv>:<ciphertext>:<authtag>  (3 segments)
    const firstColon = payload.indexOf(':');
    if (firstColon === -1) {
      throw new Error('Invalid PII payload format');
    }
    const ivHex = payload.slice(0, firstColon);
    const rest = payload.slice(firstColon + 1); // <ciphertext>:<authtag>
    return this.decrypt(rest, ivHex);
  }

  /**
   * Returns true when the given string looks like an encrypted PII payload
   * (i.e. has the <hexIV>:<hexCiphertext>:<hexAuthTag> structure).
   */
  isEncrypted(value: string): boolean {
    const parts = value.split(':');
    // IV (32 hex chars) + ciphertext (non-empty hex) + authTag (32 hex chars)
    return (
      parts.length === 3 &&
      /^[0-9a-f]{32}$/i.test(parts[0]) &&
      parts[1].length > 0 &&
      /^[0-9a-f]{32}$/i.test(parts[2])
    );
  }
}

export const cryptoService = new CryptoService();

// ── PII field definitions ─────────────────────────────────────────────────────
// Prisma model name → set of column names that hold PII and must be
// encrypted at rest.  Extend this map when new PII fields are added.

export const PII_FIELDS: Record<string, Set<string>> = {
  KycCustomer: new Set(['firstName', 'lastName', 'email']),
  User: new Set(['email', 'phone']),
};

// ── Prisma middleware helpers ─────────────────────────────────────────────────

type PlainObject = Record<string, unknown>;

/**
 * Encrypts every PII field present in `data` for the given Prisma model.
 * Unknown models or fields are left untouched.
 */
export function encryptPiiFields(model: string, data: PlainObject): PlainObject {
  const fields = PII_FIELDS[model];
  if (!fields) return data;

  const result = { ...data };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 0) {
      result[field] = cryptoService.encryptPii(value);
    }
  }
  return result;
}

/**
 * Decrypts every PII field present in `record` for the given Prisma model.
 * Fields that are null, undefined, or do not match the encrypted format are
 * returned as-is so that partially-migrated data does not break reads.
 */
export function decryptPiiFields(model: string, record: PlainObject): PlainObject {
  const fields = PII_FIELDS[model];
  if (!fields) return record;

  const result = { ...record };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 0) {
      try {
        result[field] = cryptoService.decryptPii(value);
      } catch {
        // If decryption fails the value is likely plain-text (pre-migration row).
        // Leave it as-is to avoid data loss.
      }
    }
  }
  return result;
}

// ── Prisma $use middleware ────────────────────────────────────────────────────

type MiddlewareParams = {
  model?: string;
  action: string;
  args: PlainObject;
};

type NextFn = (params: MiddlewareParams) => Promise<unknown>;

/**
 * Prisma middleware that transparently encrypts PII on write and decrypts on
 * read for all models listed in `PII_FIELDS`.
 *
 * Usage (in lib/prisma.ts or similar):
 *   prisma.$use(piiEncryptionMiddleware);
 *
 * Write actions covered : create, update, upsert, createMany, updateMany
 * Read actions covered  : findUnique, findFirst, findMany, findUniqueOrThrow,
 *                         findFirstOrThrow
 */
export async function piiEncryptionMiddleware(
  params: MiddlewareParams,
  next: NextFn
): Promise<unknown> {
  const model = params.model ?? '';

  // ── Encrypt on write ──────────────────────────────────────────────────────
  if (['create', 'update'].includes(params.action)) {
    const args = params.args as { data?: PlainObject };
    if (args.data && typeof args.data === 'object') {
      args.data = encryptPiiFields(model, args.data as PlainObject);
    }
  }

  if (params.action === 'upsert') {
    const args = params.args as { create?: PlainObject; update?: PlainObject };
    if (args.create) args.create = encryptPiiFields(model, args.create);
    if (args.update) args.update = encryptPiiFields(model, args.update);
  }

  if (['createMany', 'updateMany'].includes(params.action)) {
    const args = params.args as { data?: PlainObject | PlainObject[] };
    if (Array.isArray(args.data)) {
      args.data = args.data.map((item) => encryptPiiFields(model, item));
    } else if (args.data && typeof args.data === 'object') {
      args.data = encryptPiiFields(model, args.data as PlainObject);
    }
  }

  const result = await next(params);

  // ── Decrypt on read ───────────────────────────────────────────────────────
  const readActions = new Set([
    'findUnique',
    'findFirst',
    'findMany',
    'findUniqueOrThrow',
    'findFirstOrThrow',
  ]);

  if (readActions.has(params.action)) {
    if (Array.isArray(result)) {
      return result.map((record) =>
        record && typeof record === 'object'
          ? decryptPiiFields(model, record as PlainObject)
          : record
      );
    }
    if (result && typeof result === 'object') {
      return decryptPiiFields(model, result as PlainObject);
    }
  }

  return result;
}
