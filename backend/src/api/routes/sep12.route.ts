import { Router, Request, Response, NextFunction } from 'express';
import multer, { MulterError } from 'multer';
import { fileTypeFromFile } from 'file-type';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { sep12Controller } from '../controllers/sep12.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { isValidStellarPublicKey } from '../../utils/stellar-address';
import { config } from '../../config/env';

const router = Router();

// Ensure upload directory exists
const uploadDir = path.join(process.cwd(), 'uploads/kyc');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/** Strips anything but alphanumerics/underscore/hyphen so it is safe to use as a filename component. */
function sanitizeFilenameComponent(value: string, fallback: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 100) : fallback;
}

/** Only accepts a short, plain-ASCII extension; anything else (including path separators) is dropped. */
function sanitizeExtension(originalname: string): string {
  const ext = path.extname(originalname).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}

// Configure Multer for local disk storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const safeField = sanitizeFilenameComponent(file.fieldname, 'file');
    const safeExt = sanitizeExtension(file.originalname);
    cb(null, safeField + '-' + uniqueSuffix + safeExt);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: config.SEP12_MAX_FILE_SIZE_MB * 1024 * 1024 },
});

/** Runs `upload.any()`, translating Multer's own errors (e.g. oversized files) into a 400 response. */
function handleUpload(req: Request, res: Response, next: NextFunction) {
  upload.any()(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: `File exceeds maximum allowed size of ${config.SEP12_MAX_FILE_SIZE_MB} MB`,
        });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return next(err);
    }
    return next();
  });
}

/** Magic-number-verified content types accepted for KYC document uploads. */
const ALLOWED_UPLOAD_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

/**
 * Middleware: inspects the binary content (magic numbers) of files multer has
 * already written to disk, rejecting anything whose real content type is not
 * an allow-listed image/PDF format. Applied to PUT /customer after
 * `upload.any()`, so extension-spoofed or polyglot uploads (e.g. an
 * executable renamed to `.png`) are caught before the request reaches the
 * controller.
 */
async function validateUploadedFileContent(req: Request, res: Response, next: NextFunction) {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    return next();
  }

  const cleanup = () =>
    Promise.all(files.map((file) => fs.promises.unlink(file.path).catch(() => undefined)));

  try {
    for (const file of files) {
      const detected = await fileTypeFromFile(file.path);
      if (!detected || !ALLOWED_UPLOAD_MIME_TYPES.has(detected.mime)) {
        await cleanup();
        return res.status(400).json({
          error: `File "${file.fieldname}" is not a supported document type. Accepted types: ${Array.from(ALLOWED_UPLOAD_MIME_TYPES).join(', ')}`,
        });
      }
    }
    return next();
  } catch (error) {
    await cleanup();
    return res.status(400).json({ error: 'Failed to validate uploaded file content' });
  }
}

const stellarAccountSchema = z
  .string()
  .min(1, 'account is required')
  .refine(isValidStellarPublicKey, { message: 'account must be a valid Stellar public key' });

/** GET /customer — query params */
export const getCustomerQuerySchema = z.object({
  account: stellarAccountSchema,
  memo: z.string().optional(),
  memo_type: z.enum(['id', 'text', 'hash']).optional(),
  type: z.string().optional(),
  lang: z.string().optional(),
});

/** PUT /customer — request body (JSON / form fields after multer) */
export const putCustomerBodySchema = z
  .object({
    account: stellarAccountSchema,
    memo: z.string().optional(),
    memo_type: z.enum(['id', 'text', 'hash']).optional(),
    first_name: z.string().min(1).optional(),
    last_name: z.string().min(1).optional(),
    email_address: z.string().email('email_address must be a valid email').optional(),
    mobile_number: z.string().optional(),
    birth_date: z.string().optional(),
    bank_account_number: z.string().optional(),
    bank_number: z.string().optional(),
    bank_phone_number: z.string().optional(),
    tax_id: z.string().optional(),
    tax_id_name: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state_or_province: z.string().optional(),
    postal_code: z.string().optional(),
    country_code: z.string().optional(),
    ip_address: z.string().optional(),
    photo_id_type: z.string().optional(),
    photo_id_number: z.string().optional(),
  })
  .passthrough();

/** DELETE /customer/:account — path params */
export const deleteCustomerParamsSchema = z.object({
  account: stellarAccountSchema,
});

/**
 * Middleware: validate file_size does not exceed SEP12_MAX_FILE_SIZE_MB.
 * Applied to POST /customer/upload-url before the controller.
 */
function validateUploadFileSize(req: Request, res: Response, next: NextFunction) {
  const fileSizeBytes = Number(req.body?.file_size);
  const maxBytes = config.SEP12_MAX_FILE_SIZE_MB * 1024 * 1024;
  if (!fileSizeBytes || isNaN(fileSizeBytes)) {
    return res.status(400).json({ error: 'file_size is required' });
  }
  if (fileSizeBytes > maxBytes) {
    return res.status(400).json({
      error: `file_size exceeds maximum allowed size of ${config.SEP12_MAX_FILE_SIZE_MB} MB`,
    });
  }
  return next();
}

/**
 * @swagger
 * /sep12/customer:
 *   put:
 *     summary: Upload customer information and documents
 *     description: Submits KYC fields (JSON or multipart form) and optional JPEG/PNG/PDF documents to the KYC provider.
 *     tags: [SEP-12]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - account
 *             properties:
 *               account:
 *                 type: string
 *                 description: Stellar account (G...)
 *               memo_type:
 *                 type: string
 *                 enum:
 *                   - id
 *                   - text
 *                   - hash
 *               email_address:
 *                 type: string
 *                 format: email
 *               memo:
 *                 type: string
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               mobile_number:
 *                 type: string
 *               birth_date:
 *                 type: string
 *               bank_account_number:
 *                 type: string
 *               bank_number:
 *                 type: string
 *               bank_phone_number:
 *                 type: string
 *               tax_id:
 *                 type: string
 *               tax_id_name:
 *                 type: string
 *               address:
 *                 type: string
 *               city:
 *                 type: string
 *               state_or_province:
 *                 type: string
 *               postal_code:
 *                 type: string
 *               country_code:
 *                 type: string
 *               ip_address:
 *                 type: string
 *               photo_id_type:
 *                 type: string
 *               photo_id_number:
 *                 type: string
 *             additionalProperties: true
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - account
 *             properties:
 *               account:
 *                 type: string
 *                 description: Stellar account (G...)
 *               memo_type:
 *                 type: string
 *                 enum:
 *                   - id
 *                   - text
 *                   - hash
 *               email_address:
 *                 type: string
 *                 format: email
 *               memo:
 *                 type: string
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               mobile_number:
 *                 type: string
 *               birth_date:
 *                 type: string
 *               bank_account_number:
 *                 type: string
 *               bank_number:
 *                 type: string
 *               bank_phone_number:
 *                 type: string
 *               tax_id:
 *                 type: string
 *               tax_id_name:
 *                 type: string
 *               address:
 *                 type: string
 *               city:
 *                 type: string
 *               state_or_province:
 *                 type: string
 *               postal_code:
 *                 type: string
 *               country_code:
 *                 type: string
 *               ip_address:
 *                 type: string
 *               photo_id_type:
 *                 type: string
 *               photo_id_number:
 *                 type: string
 *             additionalProperties:
 *               type: string
 *               format: binary
 *     responses:
 *       202:
 *         description: Customer information accepted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum:
 *                     - ACCEPTED
 *                     - PROCESSING
 *                     - NEEDS_INFO
 *                     - REJECTED
 *       400:
 *         description: Invalid fields or uploaded file
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       401:
 *         description: Missing or invalid SEP-10 JWT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       403:
 *         description: Authenticated account does not match request account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 */
router.put(
  '/customer',
  authMiddleware,
  handleUpload,
  validateUploadedFileContent,
  validate({ body: putCustomerBodySchema }),
  sep12Controller.putCustomer.bind(sep12Controller)
);

/**
 * @swagger
 * /sep12/customer:
 *   get:
 *     summary: Get customer KYC status
 *     tags: [SEP-12]
 *     parameters:
 *       - in: query
 *         name: account
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar account (G...)
 *       - in: query
 *         name: memo
 *         schema:
 *           type: string
 *         description: Memo identifying a shared-account customer
 *       - in: query
 *         name: memo_type
 *         schema:
 *           type: string
 *           enum:
 *             - id
 *             - text
 *             - hash
 *         description: Memo type
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: KYC type of the customer
 *       - in: query
 *         name: lang
 *         schema:
 *           type: string
 *         description: Language code for field descriptions
 *     responses:
 *       200:
 *         description: Customer KYC status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 status:
 *                   type: string
 *                 provided_fields:
 *                   type: object
 *                 fields:
 *                   type: object
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       404:
 *         description: Customer not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 */
router.get(
  '/customer',
  validate({ query: getCustomerQuerySchema }),
  sep12Controller.getCustomer.bind(sep12Controller)
);

/**
 * @swagger
 * /sep12/customer/{account}:
 *   delete:
 *     summary: Delete customer PII
 *     description: Soft-deletes the customer KYC record; it is permanently purged after the retention period.
 *     tags: [SEP-12]
 *     parameters:
 *       - in: path
 *         name: account
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar account (G...)
 *     responses:
 *       200:
 *         description: Customer deleted
 *       400:
 *         description: Invalid account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       404:
 *         description: Customer not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 */
router.delete(
  '/customer/:account',
  validate({ params: deleteCustomerParamsSchema }),
  sep12Controller.deleteCustomer.bind(sep12Controller)
);

/**
 * @swagger
 * /sep12/customer/upload-url:
 *   post:
 *     summary: Request a pre-signed URL for direct file upload
 *     tags: [SEP-12]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - account
 *               - field_name
 *               - content_type
 *               - file_size
 *             properties:
 *               account:
 *                 type: string
 *               field_name:
 *                 type: string
 *                 description: SEP-9 field the file is for, e.g. photo_id_front
 *               content_type:
 *                 type: string
 *                 enum:
 *                   - image/jpeg
 *                   - image/png
 *                   - application/pdf
 *               file_size:
 *                 type: integer
 *                 description: File size in bytes
 *     responses:
 *       200:
 *         description: Pre-signed upload URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 upload_id:
 *                   type: string
 *                 url:
 *                   type: string
 *                   format: uri
 *                 expires_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Missing fields, disallowed content type or file too large
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       401:
 *         description: Missing or invalid SEP-10 JWT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 */
router.post('/customer/upload-url', authMiddleware, validateUploadFileSize, sep12Controller.getUploadUrl.bind(sep12Controller));

/**
 * @swagger
 * /sep12/customer/upload-confirm:
 *   post:
 *     summary: Confirm a direct file upload was completed
 *     tags: [SEP-12]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - upload_id
 *               - account
 *             properties:
 *               upload_id:
 *                 type: string
 *               account:
 *                 type: string
 *     responses:
 *       200:
 *         description: Upload confirmed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 upload_id:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum:
 *                     - COMPLETED
 *       400:
 *         description: upload_id and account are required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       401:
 *         description: Missing or invalid SEP-10 JWT
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       403:
 *         description: Account does not match session or upload record
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       404:
 *         description: Upload record not found or expired
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       422:
 *         description: File not found in storage
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 */
router.post('/customer/upload-confirm', authMiddleware, sep12Controller.confirmUpload.bind(sep12Controller));

/**
 * @swagger
 * /sep12/webhook:
 *   post:
 *     summary: Webhook for 3rd party KYC provider updates
 *     tags: [SEP-12]
 *     parameters:
 *       - in: header
 *         name: x-kyc-signature
 *         schema:
 *           type: string
 *         description: Provider signature over the JSON payload
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Provider-specific webhook payload
 *     responses:
 *       200:
 *         description: Webhook processed
 *       400:
 *         description: Invalid webhook payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       401:
 *         description: Invalid signature
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       404:
 *         description: Customer not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepError'
 */
router.post('/webhook', sep12Controller.handleWebhook.bind(sep12Controller));

export default router;
