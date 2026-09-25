/**
 * PII encryption tests for crypto.service.ts
 * Closes #1181
 */

// Set a deterministic 32-byte encryption key for tests
process.env.ENCRYPTION_KEY = 'test-key-exactly-32-bytes-long!!';

import {
  CryptoService,
  cryptoService,
  encryptPiiFields,
  decryptPiiFields,
  piiEncryptionMiddleware,
  PII_FIELDS,
} from '../services/crypto.service';

describe('CryptoService — core encrypt/decrypt', () => {
  it('encrypts a string and stores IV, ciphertext, and auth tag', () => {
    const { encryptedData, iv } = cryptoService.encrypt('sensitive-data');
    expect(iv).toMatch(/^[0-9a-f]{32}$/i); // 16-byte IV = 32 hex chars
    const parts = encryptedData.split(':');
    expect(parts).toHaveLength(2); // ciphertext:authTag
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/i); // 16-byte auth tag = 32 hex chars
  });

  it('round-trips through encrypt → decrypt', () => {
    const plaintext = 'John Doe';
    const { encryptedData, iv } = cryptoService.encrypt(plaintext);
    expect(cryptoService.decrypt(encryptedData, iv)).toBe(plaintext);
  });

  it('throws on tampered auth tag', () => {
    const { encryptedData, iv } = cryptoService.encrypt('hello');
    const tampered = encryptedData.slice(0, -2) + '00'; // flip last byte of auth tag
    expect(() => cryptoService.decrypt(tampered, iv)).toThrow();
  });

  it('throws on invalid encrypted format', () => {
    expect(() => cryptoService.decrypt('nocombinedformat', 'aabbccdd')).toThrow(
      'Invalid encrypted data format'
    );
  });
});

describe('CryptoService — PII helpers (encryptPii / decryptPii)', () => {
  it('encryptPii produces a self-contained 3-segment string', () => {
    const payload = cryptoService.encryptPii('Jane Smith');
    const parts = payload.split(':');
    expect(parts).toHaveLength(3); // <iv>:<ciphertext>:<authtag>
  });

  it('decryptPii recovers the original plaintext', () => {
    const original = 'jane@example.com';
    const payload = cryptoService.encryptPii(original);
    expect(cryptoService.decryptPii(payload)).toBe(original);
  });

  it('isEncrypted returns true for a valid payload', () => {
    const payload = cryptoService.encryptPii('test');
    expect(cryptoService.isEncrypted(payload)).toBe(true);
  });

  it('isEncrypted returns false for plain-text', () => {
    expect(cryptoService.isEncrypted('plain text')).toBe(false);
    expect(cryptoService.isEncrypted('John Doe')).toBe(false);
  });

  it('each call produces a different ciphertext (random IV)', () => {
    const a = cryptoService.encryptPii('same value');
    const b = cryptoService.encryptPii('same value');
    expect(a).not.toBe(b);
  });
});

describe('CryptoService — constructor validation', () => {
  it('throws when ENCRYPTION_KEY is not 32 bytes', () => {
    const originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'tooshort';
    expect(() => new CryptoService()).toThrow('ENCRYPTION_KEY must be exactly 32 bytes long');
    process.env.ENCRYPTION_KEY = originalKey;
  });
});

describe('PII_FIELDS map', () => {
  it('covers KycCustomer PII columns', () => {
    expect(PII_FIELDS['KycCustomer']).toBeDefined();
    expect(PII_FIELDS['KycCustomer'].has('firstName')).toBe(true);
    expect(PII_FIELDS['KycCustomer'].has('lastName')).toBe(true);
    expect(PII_FIELDS['KycCustomer'].has('email')).toBe(true);
  });

  it('covers User PII columns', () => {
    expect(PII_FIELDS['User']).toBeDefined();
    expect(PII_FIELDS['User'].has('email')).toBe(true);
    expect(PII_FIELDS['User'].has('phone')).toBe(true);
  });
});

describe('encryptPiiFields', () => {
  it('encrypts PII string fields in the KycCustomer model', () => {
    const data = { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', status: 'PENDING' };
    const result = encryptPiiFields('KycCustomer', data);

    expect(result['firstName']).not.toBe('Alice');
    expect(result['lastName']).not.toBe('Smith');
    expect(result['email']).not.toBe('alice@example.com');
    // Non-PII field is untouched
    expect(result['status']).toBe('PENDING');
  });

  it('leaves null/undefined PII fields unchanged', () => {
    const data = { firstName: null, lastName: undefined, email: 'bob@example.com' };
    const result = encryptPiiFields('KycCustomer', data as Record<string, unknown>);

    expect(result['firstName']).toBeNull();
    expect(result['lastName']).toBeUndefined();
    // email is encrypted
    expect(result['email']).not.toBe('bob@example.com');
  });

  it('returns data unchanged for unknown models', () => {
    const data = { foo: 'bar' };
    expect(encryptPiiFields('UnknownModel', data)).toEqual(data);
  });

  it('stores ciphertext in the database instead of plaintext', () => {
    const data = { firstName: 'SensitiveName', status: 'ACCEPTED' };
    const result = encryptPiiFields('KycCustomer', data);
    // The stored value must not contain the plaintext
    expect(String(result['firstName'])).not.toContain('SensitiveName');
  });
});

describe('decryptPiiFields', () => {
  it('decrypts PII fields previously encrypted by encryptPiiFields', () => {
    const original = { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' };
    const encrypted = encryptPiiFields('KycCustomer', original);
    const decrypted = decryptPiiFields('KycCustomer', encrypted);

    expect(decrypted['firstName']).toBe('Alice');
    expect(decrypted['lastName']).toBe('Smith');
    expect(decrypted['email']).toBe('alice@example.com');
  });

  it('leaves plaintext fields intact (pre-migration rows)', () => {
    // Row where email was stored before encryption was added
    const data = { firstName: 'Bob', email: 'plaintext@example.com' };
    const result = decryptPiiFields('KycCustomer', data);
    // Plain text is returned as-is, no exception thrown
    expect(result['firstName']).toBe('Bob');
    expect(result['email']).toBe('plaintext@example.com');
  });

  it('returns data unchanged for unknown models', () => {
    const data = { foo: 'bar' };
    expect(decryptPiiFields('UnknownModel', data)).toEqual(data);
  });
});

describe('piiEncryptionMiddleware', () => {
  function makeNextFn(returnValue: unknown = {}): jest.Mock {
    return jest.fn().mockResolvedValue(returnValue);
  }

  it('encrypts data.* PII on create', async () => {
    const params = {
      model: 'KycCustomer',
      action: 'create',
      args: { data: { firstName: 'Alice', email: 'alice@example.com', status: 'PENDING' } },
    };
    const next = makeNextFn({ id: '1' });
    await piiEncryptionMiddleware(params, next);

    const calledArgs = next.mock.calls[0][0].args.data;
    expect(calledArgs.firstName).not.toBe('Alice');
    expect(calledArgs.email).not.toBe('alice@example.com');
    expect(calledArgs.status).toBe('PENDING'); // not a PII field
  });

  it('encrypts data.* PII on update', async () => {
    const params = {
      model: 'User',
      action: 'update',
      args: { data: { email: 'new@example.com', phone: '555-1234' } },
    };
    const next = makeNextFn({ id: '2' });
    await piiEncryptionMiddleware(params, next);

    const calledArgs = next.mock.calls[0][0].args.data;
    expect(calledArgs.email).not.toBe('new@example.com');
    expect(calledArgs.phone).not.toBe('555-1234');
  });

  it('decrypts PII on findUnique', async () => {
    const plainRecord = { firstName: 'Alice', lastName: 'Doe', email: 'alice@example.com', status: 'ACCEPTED' };
    const encryptedRecord = encryptPiiFields('KycCustomer', { ...plainRecord });

    const params = { model: 'KycCustomer', action: 'findUnique', args: {} };
    const next = makeNextFn(encryptedRecord);
    const result = await piiEncryptionMiddleware(params, next) as Record<string, unknown>;

    expect(result['firstName']).toBe('Alice');
    expect(result['lastName']).toBe('Doe');
    expect(result['email']).toBe('alice@example.com');
    expect(result['status']).toBe('ACCEPTED');
  });

  it('decrypts PII on findMany (array result)', async () => {
    const records = [
      encryptPiiFields('KycCustomer', { firstName: 'Alice', email: 'alice@example.com' }),
      encryptPiiFields('KycCustomer', { firstName: 'Bob', email: 'bob@example.com' }),
    ];

    const params = { model: 'KycCustomer', action: 'findMany', args: {} };
    const next = makeNextFn(records);
    const result = await piiEncryptionMiddleware(params, next) as Array<Record<string, unknown>>;

    expect(result[0]['firstName']).toBe('Alice');
    expect(result[1]['firstName']).toBe('Bob');
  });

  it('passes through non-PII model unchanged', async () => {
    const params = {
      model: 'Transaction',
      action: 'create',
      args: { data: { amount: '100', assetCode: 'USDC' } },
    };
    const next = makeNextFn({ id: '3' });
    await piiEncryptionMiddleware(params, next);

    const calledArgs = next.mock.calls[0][0].args.data;
    expect(calledArgs.amount).toBe('100');
    expect(calledArgs.assetCode).toBe('USDC');
  });

  it('encrypts upsert create and update fields', async () => {
    const params = {
      model: 'KycCustomer',
      action: 'upsert',
      args: {
        create: { firstName: 'Carol', email: 'carol@example.com' },
        update: { firstName: 'Carol Updated', email: 'carol-new@example.com' },
      },
    };
    const next = makeNextFn({});
    await piiEncryptionMiddleware(params, next);

    const calledArgs = next.mock.calls[0][0].args;
    expect(calledArgs.create.firstName).not.toBe('Carol');
    expect(calledArgs.update.firstName).not.toBe('Carol Updated');
  });
});
