import { migratePlaintextToEncrypted, ENCRYPTED_FIELDS } from '../lib/prisma-encryption';

jest.mock('../lib/prisma', () => ({
  kycCustomer: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('../lib/key-management.service', () => ({
  getKeyManagementService: jest.fn(() => ({
    encryptKey: jest.fn().mockResolvedValue({ 
      ciphertext: 'encrypted_data', 
      keyVersion: '1', 
      algorithm: 'AES-256-GCM', 
      timestamp: Date.now() 
    }),
  })),
}));

describe('Prisma Encryption Migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should migrate plaintext PII to encrypted format', async () => {
    const prisma = require('../lib/prisma');
    
    prisma.kycCustomer.findMany
      .mockResolvedValueOnce([
        { id: 'cust-1', firstName: 'John', lastName: 'Doe', taxId: '123-45' },
      ])
      .mockResolvedValueOnce([]);

    prisma.kycCustomer.update.mockResolvedValue({ id: 'cust-1' });

    const result = await migratePlaintextToEncrypted(prisma.kycCustomer as any, 100);

    expect(result.migrated).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('should skip already encrypted fields', async () => {
    const prisma = require('../lib/prisma');
    
    prisma.kycCustomer.findMany
      .mockResolvedValueOnce([
        { id: 'cust-1', firstName: 'enc:already_encrypted', lastName: 'Plaintext' },
      ])
      .mockResolvedValueOnce([]);

    prisma.kycCustomer.update.mockResolvedValue({ id: 'cust-1' });

    const result = await migratePlaintextToEncrypted(prisma.kycCustomer as any, 100);

    expect(result.migrated).toBe(1);
    expect(prisma.kycCustomer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { lastName: expect.any(String) },
    });
  });

  it('should handle errors gracefully', async () => {
    const prisma = require('../lib/prisma');
    
    prisma.kycCustomer.findMany
      .mockResolvedValueOnce([
        { id: 'cust-1', firstName: 'John' },
      ])
      .mockResolvedValueOnce([]);

    prisma.kycCustomer.update.mockRejectedValue(new Error('DB error'));

    const result = await migratePlaintextToEncrypted(prisma.kycCustomer as any, 100);

    expect(result.migrated).toBe(0);
    expect(result.errors).toBe(1);
  });
});