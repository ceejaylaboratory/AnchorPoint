import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { sep12Controller } from '../controllers/sep12.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// Ensure upload directory exists
const uploadDir = path.join(process.cwd(), 'uploads/kyc');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer for local disk storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

/**
 * @swagger
 * /sep12/customer:
 *   put:
 *     summary: Upload customer information and documents
 *     tags: [SEP-12]
 */
router.put('/customer', upload.any(), sep12Controller.putCustomer.bind(sep12Controller));
router.put('/customer', authMiddleware, upload.any(), sep12Controller.putCustomer);

/**
 * @swagger
 * /sep12/customer:
 *   get:
 *     summary: Get customer KYC status
 *     tags: [SEP-12]
 */
router.get('/customer', sep12Controller.getCustomer.bind(sep12Controller));

/**
 * @swagger
 * /sep12/customer/{account}:
 *   delete:
 *     summary: Delete customer PII
 *     tags: [SEP-12]
 */
router.delete('/customer/:account', sep12Controller.deleteCustomer.bind(sep12Controller));

/**
 * @swagger
 * /sep12/webhook:
 *   post:
 *     summary: Webhook for 3rd party KYC provider updates
 *     tags: [SEP-12]
 */
router.post('/webhook', sep12Controller.handleWebhook.bind(sep12Controller));

export default router;
