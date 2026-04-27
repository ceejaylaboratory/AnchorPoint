import { Router, Request, Response } from 'express';
import { stellarService } from '../../services/stellar.service';
import { NetworkType } from '../../config/networks';
import logger from '../../utils/logger';
import { auditLog } from '../middleware/audit-log.middleware';
import { queryAuditLogs } from '../../services/audit-log.service';

const router = Router();

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
router.post('/network', auditLog({
  action: 'NETWORK_SWITCH',
  resourceType: 'network',
  getBefore: () => ({ network: stellarService.getNetwork() }),
}), (req: Request, res: Response) => {
  const { network } = req.body;

  if (!Object.values(NetworkType).includes(network)) {
    return res.status(400).json({ error: 'Invalid network type' });
  }

  try {
    stellarService.setNetwork(network as NetworkType);
    logger.info(`Switched to Stellar network: ${network}`);
    res.locals.auditAfter = { network };
    res.json({ message: `Switched to ${network} successfully`, network });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /admin/audit-logs:
 *   get:
 *     summary: Query audit logs
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *       - in: query
 *         name: resourceType
 *         schema:
 *           type: string
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Audit logs retrieved
 */
router.get('/audit-logs', async (req: Request, res: Response) => {
  try {
    const { userId, resourceType, action, page, limit } = req.query as Record<string, string>;
    const result = await queryAuditLogs({
      userId,
      resourceType,
      action,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.json({ status: 'success', data: result });
  } catch (error) {
    logger.error('Error fetching audit logs:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch audit logs' });
  }
});

export default router;
