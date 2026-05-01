import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { stellarService } from '../../services/stellar.service';
import { NetworkType } from '../../config/networks';
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

export default router;
