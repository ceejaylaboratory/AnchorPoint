import { Response } from 'express';
import { StrKey } from '@stellar/stellar-sdk';
import prisma from '../../lib/prisma';
import { cryptoService } from '../../services/crypto.service';
import { kycProvider, KycStatus } from '../../services/kyc-provider.service';
import { KYCStatus } from '@prisma/client';
import { AuthRequest } from '../middleware/auth.middleware';
import logger from '../../utils/logger';

type UploadedFiles = { [fieldname: string]: Array<{ path: string }> };

const pack = (enc?: { encryptedData: string; iv: string } | null) =>
  enc ? `${enc.iv}|${enc.encryptedData}` : null;

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

      if (req.user!.publicKey !== account) {
        return res.status(403).json({ error: 'Authenticated account does not match request account' });
      }

      let user = await prisma.user.findUnique({ where: { publicKey: account } });
      if (!user) {
        user = await prisma.user.create({ data: { publicKey: account } });
      }

      const uploadedFiles = (req as AuthRequest & { files?: UploadedFiles }).files;
      const documents: Record<string, string> = {};
      if (uploadedFiles) {
        for (const field of Object.keys(uploadedFiles)) {
          documents[field] = uploadedFiles[field][0].path;
        }
      }

      const extraPayload: Record<string, unknown> = { ...otherFields };
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
        ),
        status: KYCStatus.PENDING,
      };

      const kycCustomer = await prisma.kycCustomer.upsert({
        where: { userId: user.id },
        update: dbData,
        create: dbData,
      });

      const customerData = {
        account,
        firstName: first_name,
        lastName: last_name,
        email: email_address,
        extraFields: otherFields,
      };

      let providerStatus = KycStatus.PENDING;
      try {
        const providerRes = await kycProvider.submitCustomer(customerData, documents);
        providerStatus = providerRes.status;

        await prisma.kycCustomer.update({
          where: { id: kycCustomer.id },
          data: {
            provider: kycProvider.providerName,
            providerRef: providerRes.providerRef,
            status: this.toDbStatus(providerRes.status),
          },
        });
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
      if (!user || !user.kycCustomer) {
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
      if (user) {
        await prisma.kycCustomer.delete({ where: { userId: user.id } });
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
        });
      }

      if (!targetCustomer && event.account) {
        const user = await prisma.user.findUnique({
          where: { publicKey: event.account },
          include: { kycCustomer: true },
        });
        targetCustomer = user?.kycCustomer ?? null;
      }

      if (!targetCustomer) return res.status(404).json({ error: 'Customer not found' });

      await prisma.kycCustomer.update({
        where: { id: targetCustomer.id },
        data: { status: this.toDbStatus(event.status) },
      });

      res.status(200).send('OK');
    } catch (error) {
      logger.error('SEP-12 webhook handling failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}

export const sep12Controller = new Sep12Controller();
