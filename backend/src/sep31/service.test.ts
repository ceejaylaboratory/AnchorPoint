/**
 * Unit tests for backend/src/sep31/service.ts
 *
 * Covers:
 *  - generateMemo: text / id / hash types
 *  - validateMemo: text / id / hash validation rules
 *  - checkReceiverKyc: ACCEPTED passes, non-ACCEPTED rejects, DB error rejects
 *  - createSep31Transaction:
 *      - auto-generates memo when none supplied
 *      - accepts valid user-supplied memo
 *      - rejects invalid memo format
 *      - rejects when receiver KYC is not ACCEPTED
 */

import {
  generateMemo,
  validateMemo,
  checkReceiverKyc,
  createSep31Transaction,
} from './service';

// Mock prisma
jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    kycCustomer: {
      findFirst: jest.fn(),
    },
  },
}));

import prisma from '../lib/prisma';
const mockPrisma = prisma as unknown as {
  kycCustomer: { findFirst: jest.Mock };
};

// ─── generateMemo ─────────────────────────────────────────────────────────

describe('generateMemo', () => {
  it('defaults to "id" type', () => {
    const { memo_type } = generateMemo();
    expect(memo_type).toBe('id');
  });

  it('generates unique values across calls', () => {
    const { memo: a } = generateMemo('id');
    const { memo: b } = generateMemo('id');
    expect(a).not.toBe(b);
  });

  describe('text type', () => {
    it('returns memo_type="text"', () => {
      expect(generateMemo('text').memo_type).toBe('text');
    });

    it('produces at most 12 uppercase chars', () => {
      const { memo } = generateMemo('text');
      expect(memo).toMatch(/^[A-F0-9]{12}$/);
    });
  });

  describe('id type', () => {
    it('returns memo_type="id"', () => {
      expect(generateMemo('id').memo_type).toBe('id');
    });

    it('produces a non-negative integer string', () => {
      const { memo } = generateMemo('id');
      expect(/^\d+$/.test(memo)).toBe(true);
      expect(BigInt(memo) >= 0n).toBe(true);
    });
  });

  describe('hash type', () => {
    it('returns memo_type="hash"', () => {
      expect(generateMemo('hash').memo_type).toBe('hash');
    });

    it('produces a 64-character lowercase hex string', () => {
      const { memo } = generateMemo('hash');
      expect(memo).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});

// ─── validateMemo ─────────────────────────────────────────────────────────

describe('validateMemo', () => {
  describe('text', () => {
    it('accepts a valid short string', () => {
      expect(validateMemo('ROUTING123', 'text')).toBeNull();
    });

    it('rejects empty string', () => {
      expect(validateMemo('', 'text')).toBeTruthy();
    });

    it('rejects strings longer than 28 bytes', () => {
      expect(validateMemo('A'.repeat(29), 'text')).toBeTruthy();
    });

    it('accepts exactly 28-byte ASCII string', () => {
      expect(validateMemo('A'.repeat(28), 'text')).toBeNull();
    });
  });

  describe('id', () => {
    it('accepts a valid uint64 string', () => {
      expect(validateMemo('123456789', 'id')).toBeNull();
    });

    it('accepts zero', () => {
      expect(validateMemo('0', 'id')).toBeNull();
    });

    it('rejects negative numbers', () => {
      expect(validateMemo('-1', 'id')).toBeTruthy();
    });

    it('rejects non-numeric strings', () => {
      expect(validateMemo('not-a-number', 'id')).toBeTruthy();
    });

    it('rejects numbers exceeding uint64 max', () => {
      // 2^64 = 18446744073709551616
      expect(validateMemo('18446744073709551616', 'id')).toBeTruthy();
    });
  });

  describe('hash', () => {
    it('accepts a valid 64-char hex string', () => {
      const hash = 'a'.repeat(64);
      expect(validateMemo(hash, 'hash')).toBeNull();
    });

    it('rejects a 63-char string', () => {
      expect(validateMemo('a'.repeat(63), 'hash')).toBeTruthy();
    });

    it('rejects a 65-char string', () => {
      expect(validateMemo('a'.repeat(65), 'hash')).toBeTruthy();
    });

    it('rejects non-hex characters', () => {
      expect(validateMemo('z'.repeat(64), 'hash')).toBeTruthy();
    });
  });
});

// ─── checkReceiverKyc ────────────────────────────────────────────────────

describe('checkReceiverKyc', () => {
  beforeEach(() => mockPrisma.kycCustomer.findFirst.mockReset());

  it('resolves when KYC status is ACCEPTED', async () => {
    mockPrisma.kycCustomer.findFirst.mockResolvedValue({ status: 'ACCEPTED' });
    await expect(checkReceiverKyc('user-1')).resolves.toBeUndefined();
  });

  it('throws receiver_kyc_required when status is PENDING', async () => {
    mockPrisma.kycCustomer.findFirst.mockResolvedValue({ status: 'PENDING' });
    await expect(checkReceiverKyc('user-2')).rejects.toMatchObject({
      code: 'receiver_kyc_required',
    });
  });

  it('throws receiver_kyc_required when status is REJECTED', async () => {
    mockPrisma.kycCustomer.findFirst.mockResolvedValue({ status: 'REJECTED' });
    await expect(checkReceiverKyc('user-3')).rejects.toMatchObject({
      code: 'receiver_kyc_required',
    });
  });

  it('throws receiver_kyc_required when no KYC record found', async () => {
    mockPrisma.kycCustomer.findFirst.mockResolvedValue(null);
    await expect(checkReceiverKyc('user-4')).rejects.toMatchObject({
      code: 'receiver_kyc_required',
    });
  });

  it('throws receiver_kyc_required when DB query fails', async () => {
    mockPrisma.kycCustomer.findFirst.mockRejectedValue(new Error('DB error'));
    await expect(checkReceiverKyc('user-5')).rejects.toMatchObject({
      code: 'receiver_kyc_required',
    });
  });
});

// ─── createSep31Transaction ──────────────────────────────────────────────

describe('createSep31Transaction', () => {
  const baseReq = {
    amount: '100',
    asset_code: 'USDC',
    sender_id: 'sender-1',
    sender_info: { first_name: 'Alice', last_name: 'Smith' },
    receiver_info: { first_name: 'Bob', last_name: 'Jones' },
  };

  beforeEach(() => mockPrisma.kycCustomer.findFirst.mockReset());

  it('auto-generates an id-type memo when none is supplied', async () => {
    const result = await createSep31Transaction(baseReq);
    expect(result.stellar_memo_type).toBe('id');
    expect(/^\d+$/.test(result.stellar_memo)).toBe(true);
  });

  it('uses user-supplied text memo when valid', async () => {
    const result = await createSep31Transaction({
      ...baseReq,
      memo: 'ROUTING001',
      memo_type: 'text',
    });
    expect(result.stellar_memo).toBe('ROUTING001');
    expect(result.stellar_memo_type).toBe('text');
  });

  it('uses user-supplied id memo when valid', async () => {
    const result = await createSep31Transaction({
      ...baseReq,
      memo: '9876543210',
      memo_type: 'id',
    });
    expect(result.stellar_memo).toBe('9876543210');
    expect(result.stellar_memo_type).toBe('id');
  });

  it('uses user-supplied hash memo when valid', async () => {
    const validHash = 'a'.repeat(64);
    const result = await createSep31Transaction({
      ...baseReq,
      memo: validHash,
      memo_type: 'hash',
    });
    expect(result.stellar_memo).toBe(validHash);
    expect(result.stellar_memo_type).toBe('hash');
  });

  it('throws invalid_field when supplied memo is malformed', async () => {
    await expect(
      createSep31Transaction({
        ...baseReq,
        memo: 'not-a-number',
        memo_type: 'id',
      })
    ).rejects.toMatchObject({ code: 'invalid_field' });
  });

  it('rejects when receiver KYC is not ACCEPTED', async () => {
    mockPrisma.kycCustomer.findFirst.mockResolvedValue({ status: 'PENDING' });
    await expect(
      createSep31Transaction({ ...baseReq, receiver_id: 'receiver-1' })
    ).rejects.toMatchObject({ code: 'receiver_kyc_required' });
  });

  it('proceeds when receiver KYC is ACCEPTED', async () => {
    mockPrisma.kycCustomer.findFirst.mockResolvedValue({ status: 'ACCEPTED' });
    const result = await createSep31Transaction({
      ...baseReq,
      receiver_id: 'receiver-accepted',
    });
    expect(result.id).toBeTruthy();
    expect(result.stellar_memo).toBeTruthy();
  });

  it('does not call KYC check when receiver_id is absent', async () => {
    await createSep31Transaction(baseReq);
    expect(mockPrisma.kycCustomer.findFirst).not.toHaveBeenCalled();
  });

  it('returns the expected response shape', async () => {
    const result = await createSep31Transaction(baseReq);
    expect(result).toMatchObject({
      id: expect.any(String),
      stellar_account_id: expect.any(String),
      stellar_memo: expect.any(String),
      stellar_memo_type: expect.any(String),
      amount_out: expect.any(String),
      amount_fee: expect.any(String),
      fee_breakdown: expect.any(Array),
    });
  });
});
