import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth.middleware';
import { RecurringPaymentsService } from '../../services/recurring-payments.service';

const service = new RecurringPaymentsService();

const createSchema = z.object({
  destination: z.string().min(1),
  assetCode: z.string().min(1),
  amount: z.string().min(1),
  cron: z.string().min(1),
});

const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']),
});

export const createRecurringPaymentSchedule = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    const body = createSchema.parse(req.body);
    const schedule = await service.createSchedule(req.user!.publicKey, body);
    return res.status(201).json({ status: 'success', data: schedule });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error instanceof Error ? error.message : 'Invalid request' });
  }
};

export const listRecurringPaymentSchedules = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    const schedules = await service.listSchedules(req.user!.publicKey);
    return res.json({ status: 'success', data: schedules });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: 'Failed to fetch schedules' });
  }
};

export const updateRecurringPaymentScheduleStatus = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    const { id } = req.params;
    const body = statusSchema.parse(req.body);
    const schedule = await service.updateScheduleStatus(req.user!.publicKey, id, body.status);
    return res.json({ status: 'success', data: schedule });
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error instanceof Error ? error.message : 'Invalid request' });
  }
};

export const deleteRecurringPaymentSchedule = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    const { id } = req.params;
    await service.deleteSchedule(req.user!.publicKey, id);
    return res.status(204).send();
  } catch (error) {
    return res.status(400).json({ status: 'error', message: error instanceof Error ? error.message : 'Invalid request' });
  }
};
