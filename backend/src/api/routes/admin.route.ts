import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { stellarService } from '../../services/stellar.service';
import { NetworkType } from '../../config/networks';
import { SEP31Service } from '../../services/sep31.service';
import { createCallbackNotifier } from '../../services/sep31CallbackNotifier';
import logger from '../../utils/logger';

const router = Router();

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

    const updateData: any = { status };
    if (stellar_transaction_id) updateData.stellar_transaction_id = stellar_transaction_id;
    if (external_transaction_id) updateData.external_transaction_id = external_transaction_id;
    if (amount_out) updateData.amount_out = amount_out;
    if (amount_fee) updateData.amount_fee = amount_fee;

    const updatedTransaction = await sep31Service.updateStatus(id, status);

    res.json({ message: 'Transaction status updated successfully', transaction: updatedTransaction });
  } catch (error: any) {
    logger.error('Error updating transaction status', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
