import { Router } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import { queueConnection, QUEUE_NAMES } from '../../config/queue';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/api/queue-dashboard');

const queues = Object.values(QUEUE_NAMES).map(
  (name) => new BullMQAdapter(new Queue(name, { connection: queueConnection }))
);

createBullBoard({ queues, serverAdapter });

const router = Router();
router.use('/', serverAdapter.getRouter());

export default router;
