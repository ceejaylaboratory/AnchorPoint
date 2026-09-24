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
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
};

const providerMock = {
  providerName: 'mock',
  submitCustomer: jest.fn(),
  verifyWebhookSignature: jest.fn(),
  parseWebhook: jest.fn(),
};

const webhookServiceMock = {
  sendKycStatusChanged: jest.fn(),
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

jest.mock('../../services/webhook.service', () => ({
  __esModule: true,
  defaultWebhookService: webhookServiceMock,
}));

jest.mock('../../services/crypto.service', () => ({
  __esModule: true,
  cryptoService: cryptoMock,
}));

jest.mock('../../config/env', () => ({
  __esModule: true,
  config: {
    SEP12_MAX_FILE_SIZE_MB: 10,
  },
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

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    StrKey: {
      ...actual.StrKey,
      isValidEd25519PublicKey: jest.fn((account: string) => account === VALID_ACCOUNT),
    },
  };
});

import { sep12Controller } from './sep12.controller';
import { uploadStore } from '../../services/upload-store.service';
import { storageProvider } from '../../services/storage-provider.service';

const storageProviderMock = storageProvider;
const uploadStoreMock = uploadStore;

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
    uploadStore._reset();

    jest.spyOn(storageProvider, 'generatePresignedPutUrl').mockResolvedValue('https://mock-bucket.mock.storage/kyc/test/field1/uuid?X-Mock-Signed=1');
    jest.spyOn(storageProvider, 'objectExists').mockResolvedValue(true);
    jest.spyOn(uploadStore, 'create');
    jest.spyOn(uploadStore, 'setStatus');

    webhookServiceMock.sendKycStatusChanged.mockResolvedValue({
      delivered: true,
      attempts: 1,
      statusCode: 200,
      responseBody: 'ok',
    });
  });

  describe('getUploadUrl', () => {
    it('returns pre-signed URL when all parameters are valid', async () => {
      const req = {
        method: 'POST',
        body: {
          account: VALID_ACCOUNT,
          field_name: 'id_photo_front',
          content_type: 'image/jpeg',
          file_size: '1000000',
        },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.getUploadUrl(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        upload_id: expect.any(String),
        url: expect.any(String),
        expires_at: expect.any(String),
      }));
      expect(storageProviderMock.generatePresignedPutUrl).toHaveBeenCalled();
      expect(uploadStoreMock.create).toHaveBeenCalled();
    });

    it('returns 400 when required parameters are missing', async () => {
      const req = {
        method: 'POST',
        body: {
          account: VALID_ACCOUNT,
        },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.getUploadUrl(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'account, field_name, content_type, and file_size are required' });
    });

    it('returns 400 when content type is invalid', async () => {
      const req = {
        method: 'POST',
        body: {
          account: VALID_ACCOUNT,
          field_name: 'id_photo_front',
          content_type: 'application/zip',
          file_size: '1000000',
        },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.getUploadUrl(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when file size is larger than max allowed', async () => {
      const req = {
        method: 'POST',
        body: {
          account: VALID_ACCOUNT,
          field_name: 'id_photo_front',
          content_type: 'image/jpeg',
          file_size: '110000000',
        },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.getUploadUrl(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('confirmUpload', () => {
    it('confirms upload when upload exists and file is present in storage', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const record = uploadStore.create(VALID_ACCOUNT, 'id_photo_front', 'image/jpeg', expiresAt);
      const req = {
        body: {
          upload_id: record.uploadId,
          account: VALID_ACCOUNT,
        },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.confirmUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        upload_id: record.uploadId,
        status: 'COMPLETED',
      });
      expect(storageProviderMock.objectExists).toHaveBeenCalled();
      expect(uploadStoreMock.setStatus).toHaveBeenCalledWith(record.uploadId, 'COMPLETED');
    });

    it('returns 400 when required parameters are missing', async () => {
      const req = {
        body: {
          account: VALID_ACCOUNT,
        },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.confirmUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when upload record not found', async () => {
      const req = {
        body: {
          upload_id: 'invalid-uuid',
          account: VALID_ACCOUNT,
        },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.confirmUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 when account does not match upload record', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const record = uploadStore.create('GBZXN7PIRZGNMHGA7MUUUF4GW3F55GQRQ5UKMJTDEFEKTGW4RHFDQLNZ', 'id_photo_front', 'image/jpeg', expiresAt);
      const req = {
        body: {
          upload_id: record.uploadId,
          account: VALID_ACCOUNT,
        },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.confirmUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 422 when file not found in storage', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const record = uploadStore.create(VALID_ACCOUNT, 'id_photo_front', 'image/jpeg', expiresAt);
      (storageProviderMock.objectExists as jest.Mock).mockResolvedValueOnce(false);
      const req = {
        body: {
          upload_id: record.uploadId,
          account: VALID_ACCOUNT,
        },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.confirmUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
    });
  });

  describe('soft delete (#1197)', () => {
    it('soft-deletes the customer instead of removing the row', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', publicKey: VALID_ACCOUNT });
      prismaMock.kycCustomer.updateMany.mockResolvedValue({ count: 1 });
      const req = { params: { account: VALID_ACCOUNT } } as unknown as Request;
      const res = makeRes();

      await sep12Controller.deleteCustomer(req, res);

      expect(prismaMock.kycCustomer.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prismaMock.kycCustomer.delete).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 404 when there is no live customer record', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', publicKey: VALID_ACCOUNT });
      prismaMock.kycCustomer.updateMany.mockResolvedValue({ count: 0 });
      const req = { params: { account: VALID_ACCOUNT } } as unknown as Request;
      const res = makeRes();

      await sep12Controller.deleteCustomer(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('treats a soft-deleted customer as not found on GET', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-1',
        publicKey: VALID_ACCOUNT,
        kycCustomer: { status: 'ACCEPTED', deletedAt: new Date() },
      });
      const req = { query: { account: VALID_ACCOUNT } } as unknown as Request;
      const res = makeRes();

      await sep12Controller.getCustomer(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
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
      expect(prismaMock.kycCustomer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'k1' },
          data: {
            provider: 'mock',
            providerRef: 'mock_123',
            status: 'PENDING',
          },
        })
      );
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

      expect(prismaMock.kycCustomer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'k1' },
          data: {
            provider: 'mock',
            providerRef: 'mock_123',
            status: 'PENDING',
          },
        })
      );

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        id: VALID_ACCOUNT,
        status: 'PROCESSING',
      });
    });

    it('triggers customer.kyc_status_updated webhook when provider immediately accepts customer on PUT', async () => {
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

      const acceptedCustomer = {
        id: 'k1',
        userId: 'u1',
        status: 'ACCEPTED',
        provider: 'mock',
        providerRef: 'mock_acc',
        user: { publicKey: VALID_ACCOUNT },
      };

      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', publicKey: VALID_ACCOUNT });
      prismaMock.kycCustomer.upsert.mockResolvedValue({ id: 'k1', status: 'PENDING' });
      prismaMock.kycCustomer.update.mockResolvedValue(acceptedCustomer);
      providerMock.submitCustomer.mockResolvedValue({
        success: true,
        status: 'ACCEPTED',
        providerRef: 'mock_acc',
      });

      await sep12Controller.putCustomer(req, res);

      expect(webhookServiceMock.sendKycStatusChanged).toHaveBeenCalledWith(
        acceptedCustomer,
        'PENDING',
        undefined
      );
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        id: VALID_ACCOUNT,
        status: 'ACCEPTED',
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

    it('resolves completed upload_id fields to storage keys', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const record = uploadStore.create(
        VALID_ACCOUNT,
        'id_photo_front',
        'image/jpeg',
        expiresAt
      );
      const storageKey = `kyc/${VALID_ACCOUNT}/id_photo_front/${record.uploadId}`;
      uploadStore.setStorageKey(record.uploadId, storageKey);
      uploadStore.setStatus(record.uploadId, 'COMPLETED');

      const req = {
        body: {
          account: VALID_ACCOUNT,
          first_name: 'Jane',
          id_photo_front_upload_id: record.uploadId,
        },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', publicKey: VALID_ACCOUNT });
      prismaMock.kycCustomer.upsert.mockResolvedValue({ id: 'k1' });
      providerMock.submitCustomer.mockResolvedValue({
        success: true,
        status: 'PENDING',
        providerRef: 'mock_upload',
      });

      await sep12Controller.putCustomer(req, res);

      expect(providerMock.submitCustomer).toHaveBeenCalledWith(
        expect.objectContaining({ account: VALID_ACCOUNT, firstName: 'Jane', extraFields: {} }),
        { id_photo_front: storageKey }
      );
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('returns 400 when upload_id is not confirmed', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const record = uploadStore.create(
        VALID_ACCOUNT,
        'id_photo_front',
        'image/jpeg',
        expiresAt
      );

      const req = {
        body: {
          account: VALID_ACCOUNT,
          id_photo_front_upload_id: record.uploadId,
        },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', publicKey: VALID_ACCOUNT });

      await sep12Controller.putCustomer(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Upload not confirmed for field: id_photo_front',
      });
      expect(providerMock.submitCustomer).not.toHaveBeenCalled();
    });

    it('returns 403 when upload_id belongs to a different account', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const record = uploadStore.create(
        'GBZXN7PIRZGNMHGA7MUUUF4GW3F55GQRQ5UKMJTDEFEKTGW4RHFDQLNZ',
        'id_photo_front',
        'image/jpeg',
        expiresAt
      );
      uploadStore.setStatus(record.uploadId, 'COMPLETED');

      const req = {
        body: {
          account: VALID_ACCOUNT,
          id_photo_front_upload_id: record.uploadId,
        },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', publicKey: VALID_ACCOUNT });

      await sep12Controller.putCustomer(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Upload account does not match request for field: id_photo_front',
      });
    });

    it('prefers upload_id over a direct multipart attachment for the same field', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const record = uploadStore.create(
        VALID_ACCOUNT,
        'id_photo_front',
        'image/jpeg',
        expiresAt
      );
      const storageKey = `kyc/${VALID_ACCOUNT}/id_photo_front/${record.uploadId}`;
      uploadStore.setStorageKey(record.uploadId, storageKey);
      uploadStore.setStatus(record.uploadId, 'COMPLETED');

      const req = {
        body: {
          account: VALID_ACCOUNT,
          first_name: 'Jane',
          id_photo_front_upload_id: record.uploadId,
        },
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
        providerRef: 'mock_pref',
      });

      await sep12Controller.putCustomer(req, res);

      expect(providerMock.submitCustomer).toHaveBeenCalledWith(
        expect.objectContaining({ account: VALID_ACCOUNT }),
        { id_photo_front: storageKey }
      );
    });

    it('produces identical provider submissions for upload_id and multipart paths', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const record = uploadStore.create(
        VALID_ACCOUNT,
        'id_photo_front',
        'image/jpeg',
        expiresAt
      );
      const storageKey = `kyc/${VALID_ACCOUNT}/id_photo_front/${record.uploadId}`;
      uploadStore.setStorageKey(record.uploadId, storageKey);
      uploadStore.setStatus(record.uploadId, 'COMPLETED');

      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', publicKey: VALID_ACCOUNT });
      prismaMock.kycCustomer.upsert.mockResolvedValue({ id: 'k1' });
      providerMock.submitCustomer.mockResolvedValue({
        success: true,
        status: 'PENDING',
        providerRef: 'mock_same',
      });

      const uploadIdReq = {
        body: {
          account: VALID_ACCOUNT,
          first_name: 'Jane',
          id_photo_front_upload_id: record.uploadId,
        },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const multipartReq = {
        body: { account: VALID_ACCOUNT, first_name: 'Jane' },
        user: { publicKey: VALID_ACCOUNT },
        files: {
          id_photo_front: [{ path: storageKey }],
        },
      } as unknown as Request;

      await sep12Controller.putCustomer(uploadIdReq, makeRes());
      const uploadIdCall = providerMock.submitCustomer.mock.calls[0];

      jest.clearAllMocks();
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', publicKey: VALID_ACCOUNT });
      prismaMock.kycCustomer.upsert.mockResolvedValue({ id: 'k1' });
      providerMock.submitCustomer.mockResolvedValue({
        success: true,
        status: 'PENDING',
        providerRef: 'mock_same',
      });

      await sep12Controller.putCustomer(multipartReq, makeRes());
      const multipartCall = providerMock.submitCustomer.mock.calls[0];

      expect(uploadIdCall).toEqual(multipartCall);
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

  it('updates customer KYC status via webhook providerRef lookup and dispatches a partner webhook', async () => {
    const req = {
      headers: { 'x-kyc-signature': 'mock-valid-signature' },
      body: { providerRef: 'mock_abc', status: 'accepted' },
    } as unknown as Request;
    const res = makeRes();
    const existingCustomer = {
      id: 'k1',
      userId: 'u1',
      provider: 'mock',
      providerRef: 'mock_abc',
      status: 'PENDING',
      createdAt: new Date('2026-03-30T10:00:00.000Z'),
      updatedAt: new Date('2026-03-30T10:00:00.000Z'),
      user: { publicKey: VALID_ACCOUNT },
    };
    const updatedCustomer = {
      ...existingCustomer,
      status: 'ACCEPTED',
      updatedAt: new Date('2026-03-30T10:05:00.000Z'),
    };

    providerMock.verifyWebhookSignature.mockReturnValue(true);
    providerMock.parseWebhook.mockReturnValue({
      providerRef: 'mock_abc',
      status: 'ACCEPTED',
    });
    prismaMock.kycCustomer.findFirst.mockResolvedValue(existingCustomer);
    prismaMock.kycCustomer.update.mockResolvedValue(updatedCustomer);

    await sep12Controller.handleWebhook(req, res);

    expect(prismaMock.kycCustomer.findFirst).toHaveBeenCalledWith({
      where: {
        provider: 'mock',
        providerRef: 'mock_abc',
      },
      include: {
        user: {
          select: {
            publicKey: true,
          },
        },
      },
    });
    expect(prismaMock.kycCustomer.update).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: { status: 'ACCEPTED' },
      include: {
        user: {
          select: {
            publicKey: true,
          },
        },
      },
    });
    expect(webhookServiceMock.sendKycStatusChanged).toHaveBeenCalledWith(
      updatedCustomer,
      'PENDING',
      undefined
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('updates customer KYC status to REJECTED via webhook and includes rejection reasons in webhook dispatch', async () => {
    const req = {
      headers: { 'x-kyc-signature': 'mock-valid-signature' },
      body: {
        providerRef: 'mock_rej_1',
        status: 'rejected',
        rejection_reasons: ['SUSPECTED_FRAUD', 'INVALID_DOCUMENT'],
      },
    } as unknown as Request;
    const res = makeRes();
    const existingCustomer = {
      id: 'k2',
      userId: 'u2',
      provider: 'mock',
      providerRef: 'mock_rej_1',
      status: 'PENDING',
      createdAt: new Date('2026-03-30T10:00:00.000Z'),
      updatedAt: new Date('2026-03-30T10:00:00.000Z'),
      user: { publicKey: VALID_ACCOUNT },
    };
    const updatedCustomer = {
      ...existingCustomer,
      status: 'REJECTED',
      updatedAt: new Date('2026-03-30T10:05:00.000Z'),
    };

    providerMock.verifyWebhookSignature.mockReturnValue(true);
    providerMock.parseWebhook.mockReturnValue({
      providerRef: 'mock_rej_1',
      status: 'REJECTED',
    });
    prismaMock.kycCustomer.findFirst.mockResolvedValue(existingCustomer);
    prismaMock.kycCustomer.update.mockResolvedValue(updatedCustomer);

    await sep12Controller.handleWebhook(req, res);

    expect(prismaMock.kycCustomer.update).toHaveBeenCalledWith({
      where: { id: 'k2' },
      data: { status: 'REJECTED' },
      include: {
        user: {
          select: {
            publicKey: true,
          },
        },
      },
    });
    expect(webhookServiceMock.sendKycStatusChanged).toHaveBeenCalledWith(
      updatedCustomer,
      'PENDING',
      ['SUSPECTED_FRAUD', 'INVALID_DOCUMENT']
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not dispatch a partner webhook when provider status is unchanged', async () => {
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
    prismaMock.kycCustomer.findFirst.mockResolvedValue({
      id: 'k1',
      userId: 'u1',
      provider: 'mock',
      providerRef: 'mock_abc',
      status: 'ACCEPTED',
      createdAt: new Date('2026-03-30T10:00:00.000Z'),
      updatedAt: new Date('2026-03-30T10:05:00.000Z'),
      user: { publicKey: VALID_ACCOUNT },
    });

    await sep12Controller.handleWebhook(req, res);

    expect(prismaMock.kycCustomer.update).not.toHaveBeenCalled();
    expect(webhookServiceMock.sendKycStatusChanged).not.toHaveBeenCalled();
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
    it('returns 400 when upload_id or account is missing', async () => {
      const req = {
        body: {},
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.confirmUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'upload_id and account are required' });
    });

    it('returns 403 when session account does not match request account', async () => {
      const req = {
        body: { upload_id: 'up1', account: VALID_ACCOUNT },
        user: { publicKey: 'GOTHER' },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.confirmUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden: session account does not match request account' });
    });

    it('returns 404 when record does not exist', async () => {
      const req = {
        body: { upload_id: 'non-existent', account: VALID_ACCOUNT },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.confirmUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Upload record not found or expired' });
    });

    it('returns 403 when record account does not match request account', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const record = uploadStore.create('GOTHER', 'id_photo_front', 'image/jpeg', expiresAt);
      const req = {
        body: { upload_id: record.uploadId, account: VALID_ACCOUNT },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.confirmUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'account does not match upload record' });
    });

    it('returns 422 when file does not exist in storage', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const record = uploadStore.create(VALID_ACCOUNT, 'id_photo_front', 'image/jpeg', expiresAt);
      const req = {
        body: { upload_id: record.uploadId, account: VALID_ACCOUNT },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      (storageProvider.objectExists as jest.Mock).mockResolvedValue(false);

      await sep12Controller.confirmUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith({ error: 'File not found in storage; upload may not have completed' });
    });

    it('returns 200 and marks upload COMPLETED when upload is confirmed', async () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const record = uploadStore.create(VALID_ACCOUNT, 'id_photo_front', 'image/jpeg', expiresAt);
      const req = {
        body: { upload_id: record.uploadId, account: VALID_ACCOUNT },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      (storageProvider.objectExists as jest.Mock).mockResolvedValue(true);

      await sep12Controller.confirmUpload(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ upload_id: record.uploadId, status: 'COMPLETED' });
      expect(uploadStore.get(record.uploadId)?.status).toBe('COMPLETED');
    });
  });

  describe('getUploadUrl', () => {
    it('returns 400 when field query param is missing', async () => {
      const req = {
        query: {},
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.getUploadUrl(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'field query parameter is required' });
    });

    it('returns 200 with upload_url when authenticated and field is provided', async () => {
      const req = {
        query: { field: 'id_photo_front' },
        user: { publicKey: VALID_ACCOUNT },
      } as unknown as Request;
      const res = makeRes();

      await sep12Controller.getUploadUrl(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const payload = (res.json as jest.Mock).mock.calls[0][0];
      expect(payload).toHaveProperty('upload_url');
      expect(payload).toHaveProperty('expires_at');
      expect(payload.field).toBe('id_photo_front');
      // upload_url must contain a token derived from the account
      expect(payload.upload_url).toContain('token=');
    });

    it('returns 401 when no token is provided (route-level auth check)', async () => {
      // Simulate the authMiddleware rejecting an unauthenticated request by
      // calling the middleware directly with no Authorization header.
      const express = require('express');
      const request = require('supertest');
      const { authMiddleware: mw } = require('../middleware/auth.middleware');

      const app = express();
      app.use(express.json());
      // Mount a lightweight version of the upload-url route.
      app.get(
        '/sep12/customer/upload-url',
        mw,
        (req: Request, res: Response) => res.status(200).send('ok')
      );

      const res = await request(app).get('/sep12/customer/upload-url');
      expect(res.statusCode).toBe(401);
    });
  });
});
