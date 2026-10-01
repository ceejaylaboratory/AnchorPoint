import { Response } from 'express';
import { StrKey } from '@stellar/stellar-sdk';
import prisma from '../../lib/prisma';
import { cryptoService } from '../../services/crypto.service';
import { kycProvider, KycStatus } from '../../services/kyc-provider.service';
import { defaultWebhookService } from '../../services/webhook.service';
import { KYCStatus } from '@prisma/client';
import { AuthRequest } from '../middleware/auth.middleware';
import logger from '../../utils/logger';
import { storageProvider } from '../../services/storage-provider.service';
import { uploadStore } from '../../services/upload-store.service';
import { config } from '../../config/env';
import { softDeleteKycCustomer } from '../../services/data-retention.service';

type UploadedFiles = { [fieldname: string]: Array<{ path: string }> };

const ALLOWED_CONTENT_TYPES = (process.env.UPLOAD_ALLOWED_CONTENT_TYPES ?? 'image/jpeg,image/png,application/pdf').split(',');
const KEY_PREFIX = process.env.STORAGE_KEY_PREFIX ?? 'kyc';
const UPLOAD_ID_SUFFIX = '_upload_id';
const pack = (enc?: { encryptedData: string; iv: string } | null) =>
  enc ? `${enc.iv}|${enc.encryptedData}` : null;

type DocumentResolution =
  | { documents: Record<string, string>; kycFields: Record<string, string> }
  | { error: string; status: 400 | 403 };

/** Resolve KYC document references from pre-signed upload IDs and/or multipart files. */
export function resolveCustomerDocuments(
  account: string,
  otherFields: Record<string, string>,
  uploadedFiles?: UploadedFiles
): DocumentResolution {
  const kycFields: Record<string, string> = {};
  const documents: Record<string, string> = {};

  for (const [key, value] of Object.entries(otherFields)) {
    if (key.endsWith(UPLOAD_ID_SUFFIX)) {
      const fieldName = key.slice(0, -UPLOAD_ID_SUFFIX.length);
      const record = uploadStore.get(value);

      if (!record || record.status === 'EXPIRED') {
        return { error: `Upload not found or expired for field: ${fieldName}`, status: 400 };
      }
      if (record.status !== 'COMPLETED') {
        return { error: `Upload not confirmed for field: ${fieldName}`, status: 400 };
      }
      if (record.account !== account) {
        return { error: `Upload account does not match request for field: ${fieldName}`, status: 403 };
      }

      documents[fieldName] =
        record.storageKey || `${KEY_PREFIX}/${account}/${record.fieldName}/${value}`;
    } else {
      kycFields[key] = value;
    }
  }

  if (uploadedFiles) {
    for (const field of Object.keys(uploadedFiles)) {
      if (!documents[field]) {
        documents[field] = uploadedFiles[field][0].path;
      }
    }
  }

  return { documents, kycFields };
}

export const SUPPLEMENTARY_KYC_FIELDS: Record<string, { description: string; optional?: boolean }> = {
  proof_of_income: { description: 'Proof of income document' },
  proof_of_address: { description: 'Proof of address document' },
  occupation: { description: 'Customer occupation', optional: true },
  employer_name: { description: 'Name of employer', optional: true },
  tax_id: { description: 'Tax identification number', optional: true },
};

export class Sep12Controller {
  private toDbStatus(status: KycStatus): KYCStatus {
    switch (status) {
      case KycStatus.ACCEPTED:
        return KYCStatus.ACCEPTED;
      case KycStatus.REJECTED:
        return KYCStatus.REJECTED;
      default:
        return KYCStatus.PENDING;
    }
  }

  private toSep12Status(status: KycStatus): string {
    switch (status) {
      case KycStatus.ACCEPTED:
        return 'ACCEPTED';
      case KycStatus.REJECTED:
        return 'REJECTED';
      default:
        return 'PROCESSING';
    }
  }

  /**
   * PUT /sep12/customer
   * Accepts customer KYC fields (JSON, form-urlencoded, or multipart) and
   * forwards the submission to the configured KYC provider.
   */
  async putCustomer(req: AuthRequest, res: Response) {
    try {
      const {
        account,
        memo: _memo,
        memo_type: _memoType,
        first_name,
        last_name,
        email_address,
        ...otherFields
      } = req.body as Record<string, string>;

      if (!account) {
        return res.status(400).json({ error: 'account is required' });
      }

      if (!StrKey.isValidEd25519PublicKey(account)) {
        return res.status(400).json({ error: 'Invalid Stellar account' });
      }

      if (req.user && req.user.publicKey !== account) {
        return res.status(403).json({
          error: 'Authenticated account does not match request account',
        });
      }

      let user = await prisma.user.findUnique({ where: { publicKey: account } });
      if (!user) {
        user = await prisma.user.create({ data: { publicKey: account } });
      }

      const uploadedFiles = (req as AuthRequest & { files?: UploadedFiles }).files;
      const resolution = resolveCustomerDocuments(account, otherFields, uploadedFiles);
      if ('error' in resolution) {
        return res.status(resolution.status).json({ error: resolution.error });
      }
      const { documents, kycFields } = resolution;

      const extraPayload: Record<string, unknown> = { ...kycFields };
      if (Object.keys(documents).length > 0) {
        extraPayload.documents = documents;
      }

      const dbData = {
        userId: user.id,
        firstName: pack(first_name ? cryptoService.encrypt(first_name) : null),
        lastName: pack(last_name ? cryptoService.encrypt(last_name) : null),
        email: pack(email_address ? cryptoService.encrypt(email_address) : null),
        extraFields: pack(
          Object.keys(extraPayload).length > 0
            ? cryptoService.encrypt(JSON.stringify(extraPayload))
            : null
        ) as any,
        status: KYCStatus.PENDING,
      };

      const kycCustomer = await prisma.kycCustomer.upsert({
        where: { userId: user.id },
        // Re-submitting KYC restores a previously soft-deleted record.
        update: { ...dbData, deletedAt: null },
        create: dbData,
      });

      const customerData = {
        account,
        firstName: first_name,
        lastName: last_name,
        email: email_address,
        extraFields: kycFields,
      };

      let providerStatus = KycStatus.PENDING;
      try {
        const providerRes = await kycProvider.submitCustomer(customerData, documents);
        providerStatus = providerRes.status;
        const nextDbStatus = this.toDbStatus(providerRes.status);

        const updatedKyc = await prisma.kycCustomer.update({
          where: { id: kycCustomer.id },
          data: {
            provider: kycProvider.providerName,
            providerRef: providerRes.providerRef,
            status: nextDbStatus,
          },
          include: {
            user: {
              select: {
                publicKey: true,
              },
            },
          },
        });

        if (nextDbStatus !== KYCStatus.PENDING) {
          const rejectionReasons =
            (providerRes as any).rejectionReasons ??
            (nextDbStatus === KYCStatus.REJECTED ? ['RISK_POLICY_VIOLATION'] : undefined);

          defaultWebhookService
            .sendKycStatusChanged(updatedKyc as any, KYCStatus.PENDING, rejectionReasons)
            .catch((error) => {
              logger.error('SEP-12 customer PUT status updated but webhook delivery failed', {
                customerId: updatedKyc.id,
                error: error instanceof Error ? error.message : String(error),
              });
            });
        }
      } catch (providerError) {
        logger.error('SEP-12 customer provider submission failed', {
          error: providerError instanceof Error ? providerError.message : 'Unknown error',
          account,
        });
      }

      logger.info('SEP-12 customer submitted', {
        account,
        status: this.toSep12Status(providerStatus),
      });

      return res.status(202).json({
        id: user.publicKey,
        status: this.toSep12Status(providerStatus),
      });
    } catch (error) {
      logger.error('SEP-12 customer PUT failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  async getCustomer(req: AuthRequest, res: Response) {
    try {
      const account = req.query.account as string;
      if (!account) return res.status(400).json({ error: 'account is required' });

      const user = await prisma.user.findUnique({ where: { publicKey: account }, include: { kycCustomer: true } });
      // Relation includes bypass the soft-delete query filter, so check deletedAt here.
      if (!user || !user.kycCustomer || user.kycCustomer.deletedAt) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      const customer = user.kycCustomer;
      const responsePayload: Record<string, unknown> = {
        id: user.publicKey,
        status: customer.status,
      };

      if (customer.status === KYCStatus.ACCEPTED) {
        responsePayload.provided_fields = {};
        if (customer.firstName) {
          (responsePayload.provided_fields as Record<string, unknown>).first_name = {
            description: 'First Name',
            status: 'ACCEPTED',
          };
        }
        if (customer.lastName) {
          (responsePayload.provided_fields as Record<string, unknown>).last_name = {
            description: 'Last Name',
            status: 'ACCEPTED',
          };
        }
        if (customer.email) {
          (responsePayload.provided_fields as Record<string, unknown>).email_address = {
            description: 'Email',
            status: 'ACCEPTED',
          };
        }
      }

      if (customer.status === KYCStatus.PENDING) {
        responsePayload.fields = SUPPLEMENTARY_KYC_FIELDS;
      }

      res.json(responsePayload);
    } catch (error) {
      logger.error('SEP-12 customer GET failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  async deleteCustomer(req: AuthRequest, res: Response) {
    try {
      const account = req.params.account;
      if (!account) return res.status(400).json({ error: 'account is required' });

      const user = await prisma.user.findUnique({ where: { publicKey: account } });
      if (user && !(await softDeleteKycCustomer(user.id))) {
        return res.status(404).json({ error: 'Customer not found' });
      }
      res.status(200).send();
    } catch (error) {
      logger.error('SEP-12 customer DELETE failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(404).json({ error: 'Customer not found' });
    }
  }

  async handleWebhook(req: AuthRequest, res: Response) {
    try {
      const signature = req.headers['x-kyc-signature'] as string | undefined;
      const payloadString = JSON.stringify(req.body);

      if (!kycProvider.verifyWebhookSignature(payloadString, signature, req.headers)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const event = kycProvider.parseWebhook(req.body);
      if (!event) {
        return res.status(400).json({ error: 'Invalid webhook payload' });
      }

      let targetCustomer = null;

      if (event.providerRef) {
        targetCustomer = await prisma.kycCustomer.findFirst({
          where: {
            provider: kycProvider.providerName,
            providerRef: event.providerRef,
          },
          include: {
            user: {
              select: {
                publicKey: true,
              },
            },
          },
        });
      }

      if (!targetCustomer && event.account) {
        const user = await prisma.user.findUnique({
          where: { publicKey: event.account },
          include: { kycCustomer: true },
        });
        targetCustomer = user?.kycCustomer && !user.kycCustomer.deletedAt
          ? { ...user.kycCustomer, user: { publicKey: user.publicKey } }
          : null;
      }

      if (!targetCustomer) return res.status(404).json({ error: 'Customer not found' });

      const nextStatus = this.toDbStatus(event.status);
      const previousStatus = targetCustomer.status;

      if (previousStatus === nextStatus) {
        return res.status(200).send('OK');
      }

      const updatedCustomer = await prisma.kycCustomer.update({
        where: { id: targetCustomer.id },
        data: { status: nextStatus },
        include: {
          user: {
            select: {
              publicKey: true,
            },
          },
        },
      });

      const rejectionReasons =
        (event as any).rejectionReasons ??
        (req.body as any).rejection_reasons ??
        (req.body as any).rejection_reason_codes ??
        (req.body as any).reasons ??
        (nextStatus === KYCStatus.REJECTED ? ['VERIFICATION_FAILED'] : undefined);

      defaultWebhookService.sendKycStatusChanged(updatedCustomer as any, previousStatus, rejectionReasons).catch((error) => {
        logger.error('SEP-12 KYC status updated but webhook delivery failed', {
          customerId: updatedCustomer.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      res.status(200).send('OK');
    } catch (error) {
      logger.error('SEP-12 webhook handling failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
  /**
   * GET /sep12/customer/upload-url
   *
   * Returns a short-lived pre-signed URL that the client can use to upload a
   * KYC document directly.  This endpoint is protected by `authMiddleware` at
   * the router level, so `req.user` is always populated when this method runs.
   *
   * The `field` query-param identifies which KYC field the upload is for
   * (e.g. `id_photo_front`).
   */
  async getUploadUrl(req: AuthRequest, res: Response) {
    if (req.method === 'POST') {
      try {
        const { account, field_name, content_type, file_size } = req.body as Record<string, string>;

        if (!account || !field_name || !content_type || !file_size) {
          return res.status(400).json({ error: 'account, field_name, content_type, and file_size are required' });
        }

        if (!ALLOWED_CONTENT_TYPES.includes(content_type)) {
          return res.status(400).json({
            error: `content_type not allowed. Accepted types: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
          });
        }

        const maxBytes = config.SEP12_MAX_FILE_SIZE_MB * 1024 * 1024;
        const fileSizeNum = Number(file_size);
        if (fileSizeNum > maxBytes) {
          return res.status(400).json({
            error: `file_size exceeds maximum allowed size of ${config.SEP12_MAX_FILE_SIZE_MB} MB`,
          });
        }

        const expiresAt = new Date(Date.now() + config.UPLOAD_URL_EXPIRY_SECONDS * 1000);
        const record = uploadStore.create(account, field_name, content_type, expiresAt);

        const url = await storageProvider.generatePresignedPutUrl(record.storageKey, content_type, config.UPLOAD_URL_EXPIRY_SECONDS);

        logger.info('SEP-12 upload-url issued', { account, field_name, uploadId: record.uploadId });

        return res.status(200).json({
          upload_id: record.uploadId,
          url,
          expires_at: expiresAt.toISOString(),
        });
      } catch (error) {
        logger.error('SEP-12 upload-url failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return res.status(500).json({ error: 'Internal Server Error' });
      }
    } else {
      try {
        const field = req.query.field as string | undefined;
        if (!field) {
          return res.status(400).json({ error: 'field query parameter is required' });
        }

        const account = req.user!.publicKey;
        const expiresAt = Date.now() + 15 * 60 * 1000;
        const uploadToken = Buffer.from(
          JSON.stringify({ account, field, expiresAt })
        ).toString('base64url');

        const uploadUrl = `/sep12/customer/upload?token=${uploadToken}`;

        logger.info('SEP-12 upload-url issued', { account, field });

        return res.status(200).json({
          upload_url: uploadUrl,
          expires_at: new Date(expiresAt).toISOString(),
          field,
        });
      } catch (error) {
        logger.error('SEP-12 upload-url GET failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return res.status(500).json({ error: 'Internal Server Error' });
      }
    }
  }

  /**
   * POST /sep12/customer/upload-confirm
   * Verifies the file was uploaded to storage and marks the record COMPLETED (issue #552).
   */
  async confirmUpload(req: AuthRequest, res: Response) {
    try {
      const { upload_id, account } = req.body as { upload_id: string; account: string };

      if (!upload_id || !account) {
        return res.status(400).json({ error: 'upload_id and account are required' });
      }

      if (req.user && req.user.publicKey !== account) {
        return res.status(403).json({ error: 'Forbidden: session account does not match request account' });
      }

      const record = uploadStore.get(upload_id);

      if (!record || record.status === 'EXPIRED') {
        return res.status(404).json({ error: 'Upload record not found or expired' });
      }

      if (record.account !== account) {
        return res.status(403).json({ error: 'account does not match upload record' });
      }

      const exists = await storageProvider.objectExists(
        record.storageKey || `${KEY_PREFIX}/${account}/${record.fieldName}/${upload_id}`
      );
      if (!exists) {
        return res.status(422).json({ error: 'File not found in storage; upload may not have completed' });
      }

      uploadStore.setStatus(upload_id, 'COMPLETED');

      logger.info('SEP-12 upload confirmed', { upload_id, account });

      return res.status(200).json({ upload_id, status: 'COMPLETED' });
    } catch (error) {
      logger.error('SEP-12 upload-confirm failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}

export const sep12Controller = new Sep12Controller();
