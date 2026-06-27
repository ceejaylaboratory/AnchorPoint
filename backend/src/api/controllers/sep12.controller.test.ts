import type { Request, Response } from 'express';

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

  it('submits customer to provider and persists provider metadata', async () => {
    const req = {
      body: {
        account: 'GACC',
        first_name: 'Jane',
        last_name: 'Doe',
        email_address: 'jane@example.com',
      },
      files: undefined,
    } as unknown as Request;
    const res = makeRes();

    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', publicKey: 'GACC' });
    prismaMock.kycCustomer.upsert.mockResolvedValue({ id: 'k1' });
    providerMock.submitCustomer.mockResolvedValue({
      success: true,
      status: 'PENDING',
      providerRef: 'mock_123',
    });

    await sep12Controller.putCustomer(req, res);

    expect(providerMock.submitCustomer).toHaveBeenCalledWith(
      {
        account: 'GACC',
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

  describe('confirmUpload', () => {
    it('returns 200 when session account matches record account', async () => {
      const req = {
        params: { id: 'kyc-record-1' },
        user: { publicKey: 'GACC' },
      } as unknown as Request;
      const res = makeRes();

      prismaMock.kycCustomer.findUnique.mockResolvedValue({
        id: 'kyc-record-1',
        user: { publicKey: 'GACC' },
      });

      await sep12Controller.confirmUpload(req as any, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 403 when session account does not match record account', async () => {
      const req = {
        params: { id: 'kyc-record-1' },
        user: { publicKey: 'GDIFF' },
      } as unknown as Request;
      const res = makeRes();

      prismaMock.kycCustomer.findUnique.mockResolvedValue({
        id: 'kyc-record-1',
        user: { publicKey: 'GACC' },
      });

      await sep12Controller.confirmUpload(req as any, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 404 when record does not exist', async () => {
      const req = {
        params: { id: 'no-such-record' },
        user: { publicKey: 'GACC' },
      } as unknown as Request;
      const res = makeRes();

      prismaMock.kycCustomer.findUnique.mockResolvedValue(null);

      await sep12Controller.confirmUpload(req as any, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 401 when no authenticated user on request', async () => {
      const req = {
        params: { id: 'kyc-record-1' },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.confirmUpload(req as any, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(prismaMock.kycCustomer.findUnique).not.toHaveBeenCalled();
    });
  });
});
