import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import {
  createRecurringPaymentSchedule,
  deleteRecurringPaymentSchedule,
  listRecurringPaymentSchedules,
  updateRecurringPaymentScheduleStatus,
} from '../controllers/recurring-payments.controller';

const router = Router();

const createBodySchema = z.object({
  destination: z.string().min(1),
  assetCode: z.string().min(1),
  amount: z.string().min(1),
  cron: z.string().min(1),
});

const statusBodySchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']),
});

router.get('/', authMiddleware, listRecurringPaymentSchedules);
router.post('/', authMiddleware, validate({ body: createBodySchema }), createRecurringPaymentSchedule);
router.patch('/:id/status', authMiddleware, validate({ body: statusBodySchema }), updateRecurringPaymentScheduleStatus);
router.delete('/:id', authMiddleware, deleteRecurringPaymentSchedule);

export default router;
