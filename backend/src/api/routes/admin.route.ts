import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { stellarService } from '../../services/stellar.service';
import { NetworkType } from '../../config/networks';
import { SEP31Service } from '../../services/sep31.service';
import { createCallbackNotifier } from '../../services/sep31CallbackNotifier';
import logger from '../../utils/logger';
import {
  AdminPasswordResetService,
  InvalidResetTokenError,
} from '../../services/admin-password-reset.service';

const router = Router();
const adminPasswordResetService = new AdminPasswordResetService();

const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

const passwordResetConfirmSchema = z.object({
  token: z.string().min(32),
  newPassword: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(128, 'Password must be at most 128 characters')
    .regex(/[a-z]/, 'Password must include a lowercase letter')
    .regex(/[A-Z]/, 'Password must include an uppercase letter')
    .regex(/[0-9]/, 'Password must include a number'),
});

// Singleton service instance
const sep31Service = new SEP31Service(createCallbackNotifier());

/**
 * @swagger
 * /admin/network:
 *   get:
 *     summary: Get current Stellar network
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Current network type
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 network:
 *                   type: string
 *                   example: TESTNET
 */
router.get('/network', (req: Request, res: Response) => {
  res.json({ network: stellarService.getNetwork() });
});

/**
 * @swagger
 * /admin/network:
 *   post:
 *     summary: Switch Stellar network
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - network
 *             properties:
 *               network:
 *                 type: string
 *                 enum: [PUBLIC, TESTNET, FUTURENET]
 *     responses:
 *       200:
 *         description: Network switched successfully
 *       400:
 *         description: Invalid network type
 */
router.post('/network', (req: Request, res: Response) => {
  const { network } = req.body;

  if (!Object.values(NetworkType).includes(network)) {
    return res.status(400).json({ error: 'Invalid network type' });
  }

  try {
    stellarService.setNetwork(network as NetworkType);
    logger.info(`Switched to Stellar network: ${network}`);
    res.json({ message: `Switched to ${network} successfully`, network });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/admin/transactions/{id}:
 *   patch:
 *     summary: Update transaction status
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending_sender, pending_stellar, pending_info_update, pending_receiver, pending_external, completed, error, refunded]
 *               stellar_transaction_id:
 *                 type: string
 *               external_transaction_id:
 *                 type: string
 *               amount_out:
 *                 type: string
 *               amount_fee:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction status updated successfully
 */
router.patch('/transactions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, stellar_transaction_id, external_transaction_id, amount_out, amount_fee } = req.body;

    const updatedTransaction = await sep31Service.updateStatus(id, status, undefined, {
      stellarTxId: stellar_transaction_id,
      externalId: external_transaction_id,
      feeAmount: amount_fee,
    });

    res.json({ message: 'Transaction status updated successfully', transaction: updatedTransaction });
  } catch (error: any) {
    logger.error('Error updating transaction status', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /admin/password-reset/request:
 *   post:
 *     summary: Request admin password reset
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Reset request accepted
 *       400:
 *         description: Invalid payload
 */
router.post('/password-reset/request', async (req: Request, res: Response) => {
  const parsed = passwordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid request body',
    });
  }

  try {
    await adminPasswordResetService.requestPasswordReset(parsed.data.email);
    return res.json({
      status: 'success',
      message:
        'If an account exists for that email, a password reset link has been sent.',
    });
  } catch (error: any) {
    logger.error('Failed to request password reset', {
      message: error?.message,
    });
    return res.status(500).json({
      status: 'error',
      message: 'Unable to process password reset request.',
    });
  }
});

/**
 * @swagger
 * /admin/password-reset/confirm:
 *   post:
 *     summary: Confirm admin password reset
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 12
 *     responses:
 *       200:
 *         description: Password updated
 *       400:
 *         description: Invalid token or payload
 */
router.post('/password-reset/confirm', async (req: Request, res: Response) => {
  const parsed = passwordResetConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid request body',
    });
  }

  try {
    await adminPasswordResetService.confirmPasswordReset(
      parsed.data.token,
      parsed.data.newPassword
    );

    return res.json({
      status: 'success',
      message: 'Password has been reset successfully.',
    });
  } catch (error: any) {
    if (error instanceof InvalidResetTokenError) {
      return res.status(400).json({
        status: 'error',
        message: error.message,
      });
    }

    logger.error('Failed to confirm password reset', {
      message: error?.message,
    });
    return res.status(500).json({
      status: 'error',
      message: 'Unable to reset password.',
    });
  }
});

const adminTransactionsQuerySchema = z.object({
  page: z.string().optional().transform(v => parseInt(v || '1', 10)).pipe(z.number().min(1)),
  limit: z.string().optional().transform(v => parseInt(v || '10', 10)).pipe(z.number().min(1).max(100)),
});

/**
 * @swagger
 * /admin/transactions:
 *   get:
 *     summary: Get all transactions with pagination (Admin only)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Items per page
 *     responses:
 *       200:
 *         description: A paginated list of transactions
 *       400:
 *         description: Invalid query parameters
 *       500:
 *         description: Internal server error
 */
router.get('/transactions', async (req: Request, res: Response) => {
  const parsed = adminTransactionsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
    });
  }

  const { page, limit } = parsed.data;
  const skip = (page - 1) * limit;

  try {
    const [transactions, total] = await Promise.all([
      import('../../lib/prisma').then(m => m.default.transaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      })),
      import('../../lib/prisma').then(m => m.default.transaction.count()),
    ]);

    return res.json({
      status: 'success',
      data: {
        transactions,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    logger.error('Failed to fetch admin transactions', { message: error?.message });
    return res.status(500).json({
      status: 'error',
      message: 'Unable to fetch transactions',
    });
  }
});

export default router;
