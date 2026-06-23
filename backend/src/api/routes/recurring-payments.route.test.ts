/**
 * Recurring Payments Route Tests
 * 
 * Tests for the recurring payments API routes
 */

import request from 'supertest';
import express from 'express';

// Define mock service methods at the top level
const mockService = {
  createSchedule: jest.fn(),
  listSchedules: jest.fn(),
  updateScheduleStatus: jest.fn(),
  deleteSchedule: jest.fn(),
};

// Mock the service BEFORE importing the router so that the controller uses the mocked service instance
jest.mock('../../services/recurring-payments.service', () => ({
  RecurringPaymentsService: jest.fn().mockImplementation(() => mockService),
}));

// Mock auth middleware BEFORE importing the router
jest.mock('../middleware/auth.middleware', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    req.user = { publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' };
    next();
  },
}));

import recurringPaymentsRouter from './recurring-payments.route';

describe('Recurring Payments Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();

    mockService.createSchedule.mockResolvedValue({
      id: 'schedule_1',
      destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      assetCode: 'XLM',
      amount: '10.0',
      cron: '0 0 * * *',
      status: 'ACTIVE',
      nextRunAt: new Date('2026-04-27T00:00:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockService.listSchedules.mockResolvedValue([]);

    mockService.updateScheduleStatus.mockResolvedValue({
      id: 'schedule_1',
      destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      assetCode: 'XLM',
      amount: '10.0',
      cron: '0 0 * * *',
      status: 'PAUSED',
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockService.deleteSchedule.mockResolvedValue(undefined);

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
      expect(response.body.data).toHaveProperty('id');
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
      mockService.createSchedule.mockRejectedValueOnce(new Error('Invalid cron expression'));
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
      mockService.createSchedule.mockRejectedValueOnce(new Error('Invalid destination Stellar address'));
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
      mockService.createSchedule.mockRejectedValueOnce(new Error('Amount must be a positive number'));
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
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(mockService.listSchedules).toHaveBeenCalledWith(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
      );
    });
  });

  describe('PATCH /api/recurring-payments/:id/status', () => {
    it('should update the status of a schedule', async () => {
      const response = await request(app)
        .patch('/api/recurring-payments/schedule_1/status')
        .send({
          status: 'PAUSED',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('PAUSED');
      expect(mockService.updateScheduleStatus).toHaveBeenCalledWith(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        'schedule_1',
        'PAUSED'
      );
    });
  });

  describe('DELETE /api/recurring-payments/:id', () => {
    it('should delete a schedule', async () => {
      const response = await request(app)
        .delete('/api/recurring-payments/schedule_1');

      expect(response.status).toBe(204);
      expect(mockService.deleteSchedule).toHaveBeenCalledWith(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        'schedule_1'
      );
    });
  });
});
