/**
 * Batch Payment Controller
 * 
 * API endpoints for batch payment operations
 */

import { Request, Response, NextFunction } from 'express';
import { BatchPaymentService } from '../services/batch-payment.service';
import { BatchPaymentError, BatchErrorType } from '../services/batch-payment.types';
import logger from '../utils/logger';
import { config } from '../config/env';

// Initialize batch payment service
const batchService = new BatchPaymentService({
  horizonUrl: config.STELLAR_HORIZON_URL,
  networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
});

/**
 * @swagger
 * /api/batch/payments:
 *   post:
 *     summary: Execute batch payments
 *     description: Execute multiple Stellar payments in a single transaction (up to 100 operations)
 *     tags: [Batch Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - payments
 *               - sourceSecretKey
 *             properties:
 *               payments:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - destination
 *                     - amount
 *                   properties:
 *                     destination:
 *                       type: string
 *                       description: Destination Stellar address
 *                     amount:
 *                       type: string
 *                       description: Amount to send
 *                     assetCode:
 *                       type: string
 *                       description: Asset code (XLM for native)
 *                     assetIssuer:
 *                       type: string
 *                       description: Asset issuer address
 *                     memo:
 *                       type: string
 *                       description: Optional memo
 *               sourceSecretKey:
 *                 type: string
 *                 description: Source account secret key
 *               baseFee:
 *                 type: number
 *                 description: Base fee in stroops (default: 100)
 *               timeoutInSeconds:
 *                 type: number
 *                 description: Transaction timeout in seconds (default: 300)
 *     responses:
 *       200:
 *         description: Batch payment successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionHash:
 *                       type: string
 *                     successfulOps:
 *                       type: number
 *                     totalOps:
 *                       type: number
 *                     feePaid:
 *                       type: number
 *                     sequenceNumber:
 *                       type: string
 *                     ledger:
 *                       type: number
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Batch payment failed
 */
export const executeBatchPayments = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { payments, sourceSecretKey, baseFee, timeoutInSeconds } = req.body;

    // Validate request body
    if (!payments || !Array.isArray(payments)) {
      res.status(400).json({
        success: false,
        error: 'Payments array is required',
      });
      return;
    }

    if (!sourceSecretKey) {
      res.status(400).json({
        success: false,
        error: 'Source secret key is required',
      });
      return;
    }

    if (payments.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Payments array cannot be empty',
      });
      return;
    }

    if (payments.length > 100) {
      res.status(400).json({
        success: false,
        error: 'Maximum 100 payments per batch',
        maxAllowed: 100,
        requested: payments.length,
      });
      return;
    }

    logger.info(`Batch payment request: ${payments.length} operations`);

    const result = await batchService.executeBatch({
      payments,
      sourceSecretKey,
      baseFee,
      timeoutInSeconds,
    });

    res.status(200).json({
      success: true,
      data: result,
      message: `Successfully executed ${result.successfulOps} payments in a single transaction`,
    });
  } catch (error: unknown) {
    logger.error(`Batch payment error: ${error}`);

    if (error instanceof BatchPaymentError) {
      const statusCode = getErrorStatusCode(error.type);
      res.status(statusCode).json({
        success: false,
        error: error.message,
        type: error.type,
        details: error.details,
      });
      return;
    }

    next(error);
  }
};

/**
 * @swagger
 * /api/batch/payments/chunked:
 *   post:
 *     summary: Execute batch payments in chunks
 *     description: Split large payment lists into multiple batches and execute them
 *     tags: [Batch Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - payments
 *               - sourceSecretKey
 *             properties:
 *               payments:
 *                 type: array
 *                 items:
 *                   type: object
 *               sourceSecretKey:
 *                 type: string
 *               chunkSize:
 *                 type: number
 *                 description: Number of payments per batch (default: 100)
 *     responses:
 *       200:
 *         description: All batches executed successfully
 */
export const executeChunkedBatchPayments = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { payments, sourceSecretKey, chunkSize } = req.body;

    if (!payments || !Array.isArray(payments)) {
      res.status(400).json({
        success: false,
        error: 'Payments array is required',
      });
      return;
    }

    if (!sourceSecretKey) {
      res.status(400).json({
        success: false,
        error: 'Source secret key is required',
      });
      return;
    }

    logger.info(`Chunked batch payment request: ${payments.length} operations`);

    const results = await batchService.executeBatchInChunks(
      payments,
      sourceSecretKey,
      chunkSize || 100
    );

    const totalOps = results.reduce((sum, r) => sum + r.totalOps, 0);
    const totalFees = results.reduce((sum, r) => sum + r.feePaid, 0);

    res.status(200).json({
      success: true,
      data: {
        batches: results,
        summary: {
          totalBatches: results.length,
          totalOperations: totalOps,
          totalFeesPaid: totalFees,
        },
      },
      message: `Successfully executed ${results.length} batches with ${totalOps} total operations`,
    });
  } catch (error: unknown) {
    logger.error(`Chunked batch payment error: ${error}`);

    if (error instanceof BatchPaymentError) {
      const statusCode = getErrorStatusCode(error.type);
      res.status(statusCode).json({
        success: false,
        error: error.message,
        type: error.type,
      });
      return;
    }

    next(error);
  }
};

/**
 * @swagger
 * /api/batch/payments/retry:
 *   post:
 *     summary: Retry failed payments
 *     description: Retry a batch of failed payment operations
 *     tags: [Batch Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - failedPayments
 *               - sourceSecretKey
 *             properties:
 *               failedPayments:
 *                 type: array
 *                 items:
 *                   type: object
 *               sourceSecretKey:
 *                 type: string
 *     responses:
 *       200:
 *         description: Retry result
 */
export const retryFailedPayments = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { failedPayments, sourceSecretKey } = req.body;

    if (!failedPayments || !Array.isArray(failedPayments)) {
      res.status(400).json({
        success: false,
        error: 'Failed payments array is required',
      });
      return;
    }

    if (!sourceSecretKey) {
      res.status(400).json({
        success: false,
        error: 'Source secret key is required',
      });
      return;
    }

    logger.info(`Retry failed payments: ${failedPayments.length} operations`);

    const result = await batchService.handlePartialFailure(
      failedPayments,
      sourceSecretKey
    );

    const statusCode = result.failed.length > 0 ? 207 : 200;

    res.status(statusCode).json({
      success: result.failed.length === 0,
      data: result,
      message:
        result.failed.length === 0
          ? 'All failed payments successfully retried'
          : `Partial success: ${result.successful.length} succeeded, ${result.failed.length} failed`,
    });
  } catch (error: unknown) {
    logger.error(`Retry failed payments error: ${error}`);

    if (error instanceof BatchPaymentError) {
      const statusCode = getErrorStatusCode(error.type);
      res.status(statusCode).json({
        success: false,
        error: error.message,
        type: error.type,
      });
      return;
    }

    next(error);
  }
};

/**
 * Map error types to HTTP status codes
 */
function getErrorStatusCode(errorType: BatchErrorType): number {
  switch (errorType) {
    case BatchErrorType.EXCEEDS_MAX_OPS:
    case BatchErrorType.INVALID_ADDRESS:
    case BatchErrorType.INVALID_ASSET:
      return 400;
    case BatchErrorType.INSUFFICIENT_BALANCE:
      return 402;
    case BatchErrorType.SEQUENCE_CONFLICT:
      return 409;
    case BatchErrorType.NETWORK_ERROR:
      return 503;
    case BatchErrorType.TRANSACTION_FAILED:
      return 500;
    default:
      return 500;
  }
}
