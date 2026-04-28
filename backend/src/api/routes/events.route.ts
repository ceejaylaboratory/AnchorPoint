import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import logger from '../../utils/logger';

const router = Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * /api/events:
 *   get:
 *     summary: Get contract events
 *     description: Retrieve a history of indexed events from AnchorPoint contracts
 *     tags: [Events]
 *     parameters:
 *       - in: query
 *         name: contractId
 *         schema:
 *           type: string
 *         description: Filter by contract ID
 *       - in: query
 *         name: eventType
 *         schema:
 *           type: string
 *         description: Filter by event type (e.g., swap, deposit)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of events to return
 *     responses:
 *       200:
 *         description: A list of events
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ContractEvent'
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { contractId, eventType, limit } = req.query;

    const events = await prisma.contractEvent.findMany({
      where: {
        ...(contractId ? { contractId: String(contractId) } : {}),
        ...(eventType ? { eventType: String(eventType) } : {}),
      },
      orderBy: { ledger: 'desc' },
      take: limit ? parseInt(String(limit), 10) : 50,
    });

    res.json(events);
  } catch (error) {
    logger.error('Error fetching events:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
