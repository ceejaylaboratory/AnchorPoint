import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import logger from '../../utils/logger';
import { eventDispatcher, EventFilter } from '../../services/event-dispatcher.service';

const router = Router();
const prisma = new PrismaClient();

/** Default number of events returned by GET / when no limit is provided. */
export const DEFAULT_EVENT_LIMIT = 50;

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
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Only return events closed at or after this date (ISO-8601)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Only return events closed at or before this date (ISO-8601)
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
    const { contractId, eventType, limit, startDate, endDate } = req.query;

    const events = await prisma.contractEvent.findMany({
      where: {
        ...(contractId ? { contractId: String(contractId) } : {}),
        ...(eventType ? { type: String(eventType) } : {}),
        ...(startDate || endDate
          ? {
              ledgerClosedAt: {
                ...(startDate ? { gte: new Date(String(startDate)) } : {}),
                ...(endDate ? { lte: new Date(String(endDate)) } : {}),
              },
            }
          : {}),
      },
      orderBy: { ledger: 'desc' },
      take: limit ? parseInt(String(limit), 10) : DEFAULT_EVENT_LIMIT,
    });

    res.json(events);
  } catch (error) {
    logger.error('Error fetching events:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * @swagger
 * /api/events/stream:
 *   get:
 *     summary: Subscribe to a live stream of contract events
 *     description: Opens a Server-Sent Events (SSE) connection that streams newly indexed contract events in real time. Optionally filter the stream by event type and/or contract ID.
 *     tags: [Events]
 *     parameters:
 *       - in: query
 *         name: eventType
 *         schema:
 *           type: string
 *         description: Only stream events of this type (e.g., swap, deposit)
 *       - in: query
 *         name: contractId
 *         schema:
 *           type: string
 *         description: Only stream events for this contract
 *     responses:
 *       200:
 *         description: Server-Sent Events stream
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 */
router.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const { eventType, contractId } = req.query;
  const filters: EventFilter = {
    ...(eventType ? { eventType: String(eventType) } : {}),
    ...(contractId ? { contractId: String(contractId) } : {}),
  };

  const unsubscribe = eventDispatcher.subscribe(res, filters);

  // Initial comment so the client knows the connection is established.
  res.write(': connected\n\n');

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    unsubscribe();
    req.removeListener('close', cleanup);
    req.removeListener('aborted', cleanup);
    res.removeListener('close', cleanup);
    res.end();
  };

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);
});

export default router;
