import type { Request, Response } from 'express';

jest.mock('@prisma/client', () => ({
  KYCStatus: {
    PENDING: 'PENDING',
    ACCEPTED: 'ACCEPTED',
    REJECTED: 'REJECTED',
  },
}));
const VALID_ACCOUNT = 'GD5DJQDKEBTHBQC7LKLDSLRGEA3KMRMFOKMJUEKSFZLWQ5E2PJDJYZNF';

const prismaMock = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  kycCustomer: {
    upsert: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
  },
};

const providerMock = {
  providerName: 'mock',
  submitCustomer: jest.fn(),
  verifyWebhookSignature: jest.fn(),
  parseWebhook: jest.fn(),
};

const cryptoMock = {
  encrypt: jest.fn((v: string) => ({ encryptedData: `${v}:enc`, iv: 'iv1' })),
  decrypt: jest.fn((v: string) => v),
};

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.mock('../../services/kyc-provider.service', () => ({
  __esModule: true,
  KycStatus: {
    PENDING: 'PENDING',
    ACCEPTED: 'ACCEPTED',
    REJECTED: 'REJECTED',
  },
  kycProvider: providerMock,
}));

jest.mock('../../services/crypto.service', () => ({
  __esModule: true,
  cryptoService: cryptoMock,
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { sep12Controller } from './sep12.controller';

const makeRes = (): Response => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('Sep12Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('putCustomer', () => {
    it('returns 400 when account is missing', async () => {
      const req = {
        body: { first_name: 'Jane' },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.putCustomer(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'account is required' });
    });

    it('returns 400 for an invalid Stellar account', async () => {
      const req = {
        body: { account: 'not-a-stellar-key' },
        user: { publicKey: 'not-a-stellar-key' },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.putCustomer(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid Stellar account' });
    });

    it('returns 403 when authenticated account does not match request account', async () => {
      const req = {
        body: { account: VALID_ACCOUNT },
        user: { publicKey: 'GBZXN7PIRZGNMHGA7MUUUF4GW3F55GQRQ5UKMJTDEFEKTGW4RHFDQLNZ' },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.putCustomer(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authenticated account does not match request account',
      });
    });

    it('creates a user when one does not exist and submits to provider', async () => {
      const req = {
        body: {
          account: VALID_ACCOUNT,
          first_name: 'Jane',
          last_name: 'Doe',
          email_address: 'jane@example.com',
        },
        user: { publicKey: VALID_ACCOUNT },
        files: undefined,
      } as unknown as Request;
      const res = makeRes();

      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({ id: 'u1', publicKey: VALID_ACCOUNT });
      prismaMock.kycCustomer.upsert.mockResolvedValue({ id: 'k1' });
      providerMock.submitCustomer.mockResolvedValue({
        success: true,
        status: 'PENDING',
        providerRef: 'mock_123',
      });

      await sep12Controller.putCustomer(req, res);

      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: { publicKey: VALID_ACCOUNT },
      });
      expect(providerMock.submitCustomer).toHaveBeenCalledWith(
        {
          account: VALID_ACCOUNT,
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          extraFields: {},
        },
        {}
      );
      expect(prismaMock.kycCustomer.update).toHaveBeenCalledWith({
        where: { id: 'k1' },
        data: {
          provider: 'mock',
          providerRef: 'mock_123',
          status: 'PENDING',
        },
      });
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        id: VALID_ACCOUNT,
        status: 'PROCESSING',
      });
    });

    it('submits customer to provider and persists provider metadata', async () => {
      const req = {
        body: {
          account: VALID_ACCOUNT,
          first_name: 'Jane',
          last_name: 'Doe',
          email_address: 'jane@example.com',
        },
        user: { publicKey: VALID_ACCOUNT },
        files: undefined,
      } as unknown as Request;
      const res = makeRes();

      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', publicKey: VALID_ACCOUNT });
      prismaMock.kycCustomer.upsert.mockResolvedValue({ id: 'k1' });
      providerMock.submitCustomer.mockResolvedValue({
        success: true,
        status: 'PENDING',
        providerRef: 'mock_123',
      });

      await sep12Controller.putCustomer(req, res);

      expect(providerMock.submitCustomer).toHaveBeenCalledWith(
        {
          account: VALID_ACCOUNT,
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          extraFields: {},
        },
        {}
      );

      expect(prismaMock.kycCustomer.update).toHaveBeenCalledWith({
        where: { id: 'k1' },
        data: {
          provider: 'mock',
          providerRef: 'mock_123',
          status: 'PENDING',
        },
      });

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        id: VALID_ACCOUNT,
        status: 'PROCESSING',
      });
    });

    it('includes uploaded document paths when files are present', async () => {
      const req = {
        body: { account: VALID_ACCOUNT, first_name: 'Jane' },
        user: { publicKey: VALID_ACCOUNT },
        files: {
          id_photo_front: [{ path: '/uploads/kyc/id-front.jpg' }],
        },
      } as unknown as Request;
      const res = makeRes();

      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', publicKey: VALID_ACCOUNT });
      prismaMock.kycCustomer.upsert.mockResolvedValue({ id: 'k1' });
      providerMock.submitCustomer.mockResolvedValue({
        success: true,
        status: 'PENDING',
        providerRef: 'mock_456',
      });

      await sep12Controller.putCustomer(req, res);

      expect(providerMock.submitCustomer).toHaveBeenCalledWith(
        expect.objectContaining({ account: VALID_ACCOUNT, firstName: 'Jane' }),
        { id_photo_front: '/uploads/kyc/id-front.jpg' }
      );
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('returns 202 with PROCESSING when provider submission fails', async () => {
      const req = {
        body: { account: VALID_ACCOUNT, first_name: 'Jane' },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', publicKey: VALID_ACCOUNT });
      prismaMock.kycCustomer.upsert.mockResolvedValue({ id: 'k1' });
      providerMock.submitCustomer.mockRejectedValue(new Error('Provider unavailable'));

      await sep12Controller.putCustomer(req, res);

      expect(prismaMock.kycCustomer.update).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        id: VALID_ACCOUNT,
        status: 'PROCESSING',
      });
    });
  });

  it('updates customer KYC status via webhook providerRef lookup', async () => {
    const req = {
      headers: { 'x-kyc-signature': 'mock-valid-signature' },
      body: { providerRef: 'mock_abc', status: 'accepted' },
    } as unknown as Request;
    const res = makeRes();

    providerMock.verifyWebhookSignature.mockReturnValue(true);
    providerMock.parseWebhook.mockReturnValue({
      providerRef: 'mock_abc',
      status: 'ACCEPTED',
    });
    prismaMock.kycCustomer.findFirst.mockResolvedValue({ id: 'k1' });

    await sep12Controller.handleWebhook(req, res);

    expect(prismaMock.kycCustomer.update).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: { status: 'ACCEPTED' },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects webhook with invalid signature', async () => {
    const req = {
      headers: { 'x-kyc-signature': 'bad' },
      body: {},
    } as unknown as Request;
    const res = makeRes();

    providerMock.verifyWebhookSignature.mockReturnValue(false);

    await sep12Controller.handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(prismaMock.kycCustomer.update).not.toHaveBeenCalled();
  });
});
