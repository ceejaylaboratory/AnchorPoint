import { Router } from 'express';
import { eventController } from '../controllers/event.controller';

const router = Router();

/**
 * @swagger
 * /api/events:
 *   get:
 *     summary: Retrieve indexed Soroban contract events
 *     tags: [Events]
 *     parameters:
 *       - in: query
 *         name: contractId
 *         schema:
 *           type: string
 *         description: Filter by contract ID
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by event type (e.g., contract)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of records to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *         description: Number of records to skip
 *     responses:
 *       200:
 *         description: List of events
 *       500:
 *         description: Server error
 */
router.get('/', eventController.getEvents);

export default router;
