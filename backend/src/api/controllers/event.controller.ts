import { Request, Response } from 'express';
import { eventIndexer } from '../../services/event-indexer.service';
import { logger } from '../../utils/logger';

/**
 * Controller for Soroban Contract Events
 */
export class EventController {
    /**
     * GET /api/events
     * Retrieve indexed contract events with optional filtering
     */
    public async getEvents(req: Request, res: Response) {
        try {
            const { contractId, type, limit, offset } = req.query;

            const events = await eventIndexer.getEventHistory({
                contractId: contractId as string,
                type: type as string,
                limit: limit ? parseInt(limit as string) : undefined,
                offset: offset ? parseInt(offset as string) : undefined
            });

            return res.json({
                success: true,
                count: events.length,
                data: events.map(e => ({
                    ...e,
                    topics: JSON.parse(e.topics),
                    value: JSON.parse(e.value)
                }))
            });
        } catch (error) {
            logger.error('Error fetching contract events:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error while fetching events'
            });
        }
    }
}

export const eventController = new EventController();
