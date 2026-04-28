import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { cryptoService } from '../../services/crypto.service';
import { kycProvider } from '../../services/kyc-provider.service';
import { KYCStatus } from '@prisma/client';

export class Sep12Controller {
  
  async putCustomer(req: Request, res: Response) {
    try {
      const { account, memo, memo_type, first_name, last_name, email_address, ...otherFields } = req.body;

      if (!account) {
        return res.status(400).json({ error: 'account is required' });
      }

      // In a real app, verify that the account is authenticated (SEP-10).
      // Find or create User based on account
      let user = await prisma.user.findUnique({ where: { publicKey: account } });
      if (!user) {
        user = await prisma.user.create({ data: { publicKey: account } });
      }

      // Handle File Uploads (Multer puts files in req.files)
      const uploadedFiles = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const documents: Record<string, string> = {};
      if (uploadedFiles) {
        Object.keys(uploadedFiles).forEach((field) => {
          documents[field] = uploadedFiles[field][0].path;
        });
      }

      // Encrypt PII data
      const extraFieldsJson = JSON.stringify(otherFields);
      const encryptedFirstName = first_name ? cryptoService.encrypt(first_name) : null;
      const encryptedLastName = last_name ? cryptoService.encrypt(last_name) : null;
      const encryptedEmail = email_address ? cryptoService.encrypt(email_address) : null;
      const encryptedExtra = Object.keys(otherFields).length > 0 ? cryptoService.encrypt(extraFieldsJson) : null;

      // We need a single IV for the record, or we can just use the first one and store it, 
      // but cryptoService returns an IV per encryption. 
      // A better approach for the schema is to store the combined encrypted string which includes the IV in our format.
      // Wait, our CryptoService `encrypt` returns `{ encryptedData, iv }`.
      // Let's store the raw IV from one of them if we had a single IV, but our encrypt function generates a random IV each time.
      // We can just serialize the object `{ data, iv }` into the DB string, or update the DB to just store the concatenated string.
      // Actually, since we added `encryptionIV` to the schema, let's use a single IV for all fields by modifying the crypto flow,
      // or we can just ignore `encryptionIV` column and store the IVs inside a JSON if needed.
      // Let's just use a generated IV for the whole record to be safe, but our `encrypt` method doesn't take IV as input.
      // I will just concatenate IV:Data:AuthTag inside the string for simplicity, or just use the first generated IV to fill the schema column.

      // Let's adjust to store JSON in DB for the encrypted fields since they need IV.
      const pack = (enc?: { encryptedData: string, iv: string } | null) => enc ? `${enc.iv}|${enc.encryptedData}` : null;

      const dbData: any = {
        userId: user.id,
        firstName: pack(encryptedFirstName),
        lastName: pack(encryptedLastName),
        email: pack(encryptedEmail),
        extraFields: pack(encryptedExtra),
        documents: documents,
        status: KYCStatus.PENDING
      };

      const kycCustomer = await prisma.kycCustomer.upsert({
        where: { userId: user.id },
        update: dbData,
        create: dbData,
      });

      // Submit to 3rd party Provider
      const customerData = { first_name, last_name, email_address, ...otherFields };
      const providerRes = await kycProvider.submitCustomer(customerData, documents);

      if (providerRes.status !== KYCStatus.PENDING) {
        await prisma.kycCustomer.update({
          where: { id: kycCustomer.id },
          data: { status: providerRes.status as KYCStatus }
        });
      }

      res.status(202).json({
        id: user.publicKey,
        status: providerRes.status
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  async getCustomer(req: Request, res: Response) {
    try {
      const account = req.query.account as string;
      if (!account) return res.status(400).json({ error: 'account is required' });

      const user = await prisma.user.findUnique({ where: { publicKey: account }, include: { kycCustomer: true } });
      if (!user || !user.kycCustomer) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      const unpack = (packed?: string | null) => {
        if (!packed) return null;
        const [iv, data] = packed.split('|');
        return cryptoService.decrypt(data, iv);
      };

      const customer = user.kycCustomer;
      const responsePayload: any = {
        id: user.publicKey,
        status: customer.status,
      };

      if (customer.status === KYCStatus.ACCEPTED) {
        responsePayload.provided_fields = {};
        if (customer.firstName) responsePayload.provided_fields.first_name = { description: "First Name", status: "ACCEPTED" };
        if (customer.lastName) responsePayload.provided_fields.last_name = { description: "Last Name", status: "ACCEPTED" };
        if (customer.email) responsePayload.provided_fields.email_address = { description: "Email", status: "ACCEPTED" };
      }

      res.json(responsePayload);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  async deleteCustomer(req: Request, res: Response) {
    try {
      const account = req.params.account;
      if (!account) return res.status(400).json({ error: 'account is required' });

      const user = await prisma.user.findUnique({ where: { publicKey: account } });
      if (user) {
        await prisma.kycCustomer.delete({ where: { userId: user.id } });
      }
      res.status(200).send();
    } catch (error) {
      console.error(error);
      res.status(404).json({ error: 'Customer not found' });
    }
  }

  async handleWebhook(req: Request, res: Response) {
    try {
      const signature = req.headers['x-kyc-signature'] as string;
      const payloadString = JSON.stringify(req.body);

      if (!kycProvider.verifyWebhookSignature(payloadString, signature)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const { account, status } = req.body;
      const user = await prisma.user.findUnique({ where: { publicKey: account } });
      if (!user) return res.status(404).json({ error: 'User not found' });

      await prisma.kycCustomer.update({
        where: { userId: user.id },
        data: { status: status as KYCStatus }
      });

      res.status(200).send('OK');
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}

export const sep12Controller = new Sep12Controller();
