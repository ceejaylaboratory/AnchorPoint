import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import {
  switchNetworkSchema,
  patchTransactionSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  purgeCacheSchema,
} from './admin.schemas';
import { stellarService } from '../../services/stellar.service';
import { NetworkType } from '../../config/networks';
import { SEP31Service } from '../../services/sep31.service';
import { createCallbackNotifier } from '../../services/sep31CallbackNotifier';
import logger from '../../utils/logger';
import {
  AdminPasswordResetService,
  InvalidResetTokenError,
} from '../../services/admin-password-reset.service';
import { purgeTomlCache } from '../../services/indexer/toml.fetcher';
import adminAuditService, {
  AdminAuditAction,
  getAuditActor,
} from '../../services/admin-audit.service';
import { listNotificationDlqJobs, retryNotificationDlqJob } from '../../config/queue';

const router = Router();
const adminPasswordResetService = new AdminPasswordResetService();

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
router.post('/network', validate({ body: switchNetworkSchema }), async (req: Request, res: Response) => {
  const { network } = req.body;

  try {
    const previousNetwork = stellarService.getNetwork();
    stellarService.setNetwork(network as NetworkType);
    logger.info(`Switched to Stellar network: ${network}`);
    await adminAuditService.recordConfigChange({
      action: 'ADMIN_NETWORK_SWITCH',
      actor: getAuditActor(req),
      targetEntity: 'stellar_network',
      before: { network: previousNetwork },
      after: { network },
    });
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
router.patch('/transactions/:id', validate({ body: patchTransactionSchema }), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, stellar_transaction_id, external_transaction_id, amount_out, amount_fee } = req.body;

    const updatedTransaction = await sep31Service.updateStatus(id, status, undefined, {
      stellarTxId: stellar_transaction_id,
      externalId: external_transaction_id,
      feeAmount: amount_fee,
    });

    await adminAuditService.recordConfigChange({
      action: 'ADMIN_TRANSACTION_STATUS_UPDATE',
      actor: getAuditActor(req),
      targetEntity: `transaction:${id}`,
      after: { status, stellar_transaction_id, external_transaction_id, amount_out, amount_fee },
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
router.post('/password-reset/request', validate({ body: passwordResetRequestSchema }), async (req: Request, res: Response) => {
  try {
    await adminPasswordResetService.requestPasswordReset(req.body.email);
    return res.json({
      status: 'success',
      message: 'If an account exists for that email, a password reset link has been sent.',
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
router.post('/password-reset/confirm', validate({ body: passwordResetConfirmSchema }), async (req: Request, res: Response) => {
  try {
    await adminPasswordResetService.confirmPasswordReset(
      req.body.token,
      req.body.newPassword
    );

    await adminAuditService.recordConfigChange({
      action: 'ADMIN_PASSWORD_RESET_CONFIRM',
      actor: getAuditActor(req),
      targetEntity: 'admin_password',
    });

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

const purgeTomlCacheSchema = z.object({
  homeDomain: z.string().optional(),
});

/**
 * @swagger
 * /admin/cache/purge-toml:
 *   post:
 *     summary: Purge SEP-1 TOML cache
 *     tags: [Admin]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               homeDomain:
 *                 type: string
 *                 description: Optional specific domain to purge. Omit to purge all entries.
 *     responses:
 *       200:
 *         description: Cache purged successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 purged:
 *                   type: integer
 *                   description: Number of cache entries removed
 */
router.post('/cache/purge-toml', validate({ body: purgeCacheSchema }), async (req: Request, res: Response) => {
  const parsed = purgeTomlCacheSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid request body',
    });
  }

  try {
    const purged = await purgeTomlCache(parsed.data.homeDomain);
    await adminAuditService.recordConfigChange({
      action: 'ADMIN_TOML_CACHE_PURGE',
      actor: getAuditActor(req),
      targetEntity: parsed.data.homeDomain ?? 'all',
      after: { purged },
    });
    res.json({ purged });
  } catch (error: any) {
    logger.error('Failed to purge TOML cache', { message: error?.message });
    res.status(500).json({ error: error.message });
  }
});

const auditLogsQuerySchema = z.object({
  action: z.string().optional(),
  actorId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.string().optional().transform(v => (v ? parseInt(v, 10) : undefined)),
  offset: z.string().optional().transform(v => (v ? parseInt(v, 10) : undefined)),
});

/**
 * @swagger
 * /admin/audit-logs:
 *   get:
 *     summary: List administrative audit log entries
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: Filter by audit action
 *       - in: query
 *         name: actorId
 *         schema:
 *           type: string
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated list of audit log entries
 *       400:
 *         description: Invalid query parameters
 */
router.get('/audit-logs', async (req: Request, res: Response) => {
  const parsed = auditLogsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
    });
  }

  const { action, actorId, startDate, endDate, limit, offset } = parsed.data;
  const parsedStartDate = startDate ? new Date(startDate) : undefined;
  const parsedEndDate = endDate ? new Date(endDate) : undefined;

  if ((startDate && isNaN(parsedStartDate!.getTime())) || (endDate && isNaN(parsedEndDate!.getTime()))) {
    return res.status(400).json({ status: 'error', message: 'Invalid date format' });
  }

  try {
    const result = await adminAuditService.listAuditLogs({
      action: action as AdminAuditAction | undefined,
      actorId,
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      limit,
      offset,
    });

    res.json({
      status: 'success',
      data: result.entries,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
  } catch (error: any) {
    logger.error('Failed to fetch admin audit logs', { message: error?.message });
    res.status(500).json({ status: 'error', message: 'Failed to fetch audit logs' });
  }
});

/**
 * @swagger
 * /api/admin/queues/notification-dlq:
 *   get:
 *     summary: List dead-lettered notification jobs
 *     description: Returns notification jobs that exhausted their retries and were moved to the notification-dlq queue.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: start
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *       - in: query
 *         name: end
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 49
 *     responses:
 *       200:
 *         description: Dead-lettered notification jobs
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
const dlqListQuerySchema = z.object({
  start: z.coerce.number().int().min(0).default(0),
  end: z.coerce.number().int().min(0).default(49),
});

router.get('/queues/notification-dlq', async (req: Request, res: Response) => {
  const parsed = dlqListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid query parameters',
    });
  }

  try {
    const jobs = await listNotificationDlqJobs(parsed.data.start, parsed.data.end);
    res.json({
      status: 'success',
      data: jobs.map((job) => ({ id: job.id, ...job.data })),
    });
  } catch (error: any) {
    logger.error('Failed to list notification DLQ jobs', { message: error?.message });
    res.status(500).json({ status: 'error', message: 'Failed to list notification DLQ jobs' });
  }
});

/**
 * @swagger
 * /api/admin/queues/notification-dlq/{jobId}/retry:
 *   post:
 *     summary: Retry a dead-lettered notification job
 *     description: Re-enqueues the job on the notifications queue and removes it from the DLQ.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job re-enqueued
 *       404:
 *         description: DLQ job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/queues/notification-dlq/:jobId/retry', async (req: Request, res: Response) => {
  try {
    const retried = await retryNotificationDlqJob(req.params.jobId);
    if (!retried) {
      return res.status(404).json({ status: 'error', message: 'DLQ job not found' });
    }
    logger.info('Retried notification DLQ job', { dlqJobId: req.params.jobId, jobId: retried.id });
    res.json({ status: 'success', data: { jobId: retried.id } });
  } catch (error: any) {
    logger.error('Failed to retry notification DLQ job', { message: error?.message });
    res.status(500).json({ status: 'error', message: 'Failed to retry notification DLQ job' });
  }
});

export default router;