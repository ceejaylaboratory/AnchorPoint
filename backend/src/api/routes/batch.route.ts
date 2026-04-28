/**
 * Batch Payment Routes
 * 
 * API routes for batch payment operations
 */

import { Router } from 'express';
import {
  executeBatchPayments,
  executeChunkedBatchPayments,
  retryFailedPayments,
} from '../controllers/batch.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Batch Payments
 *   description: Batch payment operations for reducing Stellar network fees
 */

// All batch payment routes require authentication
router.use(authenticateToken);

/**
 * POST /api/batch/payments
 * Execute multiple payments in a single Stellar transaction
 */
router.post('/payments', executeBatchPayments);

/**
 * POST /api/batch/payments/chunked
 * Split large payment lists into multiple batches
 */
router.post('/payments/chunked', executeChunkedBatchPayments);

/**
 * POST /api/batch/payments/retry
 * Retry failed payment operations
 */
router.post('/payments/retry', retryFailedPayments);

export default router;
