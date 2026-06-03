/**
 * Recurring Payments Route Tests
 * 
 * Tests for the recurring payments API routes
 */

import request from 'supertest';
import express from 'express';
import { recurringPaymentsRouter } from './recurring-payments.route';
import { RecurringPaymentsService } from '../../services/recurring-payments.service';

// Mock the service
jest.mock('../../services/recurring-payments.service');

// Mock auth middleware
jest.mock('../middleware/auth.middleware', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' };
    next();
  },
}));

describe('Recurring Payments Routes', () => {
  let app: express.Application;
  let mockService: jest.Mocked<RecurringPaymentsService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockService = {
      createSchedule: jest.fn().mockResolvedValue({
        id: 'schedule_1',
        destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        assetCode: 'XLM',
        amount: '10.0',
        cron: '0 0 * * *',
        status: 'ACTIVE',
        nextRunAt: new Date('2026-04-27T00:00:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      listSchedules: jest.fn().mockResolvedValue([]),
      getSchedule: jest.fn().mockResolvedValue({
        id: 'schedule_1',
        destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        assetCode: 'XLM',
        amount: '10.0',
        cron: '0 0 * * *',
        status: 'ACTIVE',
        nextRunAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        runs: [],
      }),
      updateSchedule: jest.fn().mockResolvedValue({
        id: 'schedule_1',
        destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        assetCode: 'XLM',
        amount: '20.0',
        cron: '0 0 * * *',
        status: 'ACTIVE',
        nextRunAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      deleteSchedule: jest.fn().mockResolvedValue(undefined),
    } as any;

    (RecurringPaymentsService as jest.Mock).mockImplementation(() => mockService);

    app = express();
    app.use(express.json());
    app.use('/api/recurring-payments', recurringPaymentsRouter);
  });

  describe('POST /api/recurring-payments', () => {
    it('should create a new recurring payment schedule', async () => {
      const response = await request(app)
        .post('/api/recurring-payments')
        .send({
          destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          assetCode: 'XLM',
          amount: '10.0',
          cron: '0 0 * * *',
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(mockService.createSchedule).toHaveBeenCalledWith(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        expect.objectContaining({
          destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          assetCode: 'XLM',
          amount: '10.0',
          cron: '0 0 * * *',
        })
      );
    });

    it('should reject invalid cron expression', async () => {
      const response = await request(app)
        .post('/api/recurring-payments')
        .send({
          destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          assetCode: 'XLM',
          amount: '10.0',
          cron: 'invalid-cron',
        });

      expect(response.status).toBe(400);
    });

    it('should reject invalid Stellar address', async () => {
      const response = await request(app)
        .post('/api/recurring-payments')
        .send({
          destination: 'INVALID_ADDRESS',
          assetCode: 'XLM',
          amount: '10.0',
          cron: '0 0 * * *',
        });

      expect(response.status).toBe(400);
    });

    it('should reject negative amount', async () => {
      const response = await request(app)
        .post('/api/recurring-payments')
        .send({
          destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          assetCode: 'XLM',
          amount: '-10.0',
          cron: '0 0 * * *',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/recurring-payments', () => {
    it('should list all schedules for the authenticated user', async () => {
      const response = await request(app)
        .get('/api/recurring-payments');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(mockService.listSchedules).toHaveBeenCalledWith(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
      );
    });
  });

  describe('GET /api/recurring-payments/:id', () => {
    it('should get a specific schedule', async () => {
      const response = await request(app)
        .get('/api/recurring-payments/schedule_1');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', 'schedule_1');
      expect(mockService.getSchedule).toHaveBeenCalledWith(
        'schedule_1',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
      );
    });
  });

  describe('PATCH /api/recurring-payments/:id', () => {
    it('should update a schedule', async () => {
      const response = await request(app)
        .patch('/api/recurring-payments/schedule_1')
        .send({
          amount: '20.0',
        });

      expect(response.status).toBe(200);
      expect(response.body.amount).toBe('20.0');
      expect(mockService.updateSchedule).toHaveBeenCalledWith(
        'schedule_1',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        { amount: '20.0' }
      );
    });
  });

  describe('DELETE /api/recurring-payments/:id', () => {
    it('should delete a schedule', async () => {
      const response = await request(app)
        .delete('/api/recurring-payments/schedule_1');

      expect(response.status).toBe(204);
      expect(mockService.deleteSchedule).toHaveBeenCalledWith(
        'schedule_1',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
      );
    });
  });
});
