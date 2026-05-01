/**
 * Recurring Payments Service Tests
 * 
 * Comprehensive tests for the recurring payments service
 */

import { RecurringPaymentsService } from './recurring-payments.service';
import { BatchPaymentService } from './batch-payment.service';

// Mock BatchPaymentService
jest.mock('./batch-payment.service');

// Mock Prisma
jest.mock('../lib/prisma', () => ({
  prisma: {
    recurringPaymentSchedule: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    recurringPaymentRun: {
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock config
jest.mock('../config/env', () => ({
  STELLAR_DISTRIBUTION_SECRET: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
}));

describe('RecurringPaymentsService', () => {
  let service: RecurringPaymentsService;
  let mockBatchPaymentService: jest.Mocked<BatchPaymentService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBatchPaymentService = {
      executeBatch: jest.fn().mockResolvedValue({
        transactionHash: 'mock_tx_hash',
        successfulOps: 1,
        totalOps: 1,
        feePaid: 100,
      }),
    } as any;
    (BatchPaymentService as jest.Mock).mockImplementation(() => mockBatchPaymentService);
    service = new RecurringPaymentsService(mockBatchPaymentService);
  });

  describe('createSchedule', () => {
    it('should create a valid recurring payment schedule', async () => {
      const { prisma } = require('../lib/prisma');
      prisma.recurringPaymentSchedule.create.mockResolvedValue({
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

      const result = await service.createSchedule('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', {
        destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        assetCode: 'XLM',
        amount: '10.0',
        cron: '0 0 * * *',
      });

      expect(result).toBeDefined();
      expect(prisma.recurringPaymentSchedule.create).toHaveBeenCalled();
    });

    it('should validate cron expression', async () => {
      await expect(
        service.createSchedule('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', {
          destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          assetCode: 'XLM',
          amount: '10.0',
          cron: 'invalid-cron',
        })
      ).rejects.toThrow('Invalid cron expression');
    });

    it('should validate Stellar address', async () => {
      await expect(
        service.createSchedule('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', {
          destination: 'INVALID_ADDRESS',
          assetCode: 'XLM',
          amount: '10.0',
          cron: '0 0 * * *',
        })
      ).rejects.toThrow('Invalid Stellar address');
    });

    it('should validate positive amount', async () => {
      await expect(
        service.createSchedule('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', {
          destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          assetCode: 'XLM',
          amount: '-10.0',
          cron: '0 0 * * *',
        })
      ).rejects.toThrow('Amount must be a positive number');
    });
  });

  describe('listSchedules', () => {
    it('should list schedules for a user', async () => {
      const { prisma } = require('../lib/prisma');
      prisma.recurringPaymentSchedule.findMany.mockResolvedValue([]);

      const result = await service.listSchedules('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');

      expect(result).toEqual([]);
      expect(prisma.recurringPaymentSchedule.findMany).toHaveBeenCalledWith({
        where: { user: { publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' } },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getSchedule', () => {
    it('should get a specific schedule', async () => {
      const { prisma } = require('../lib/prisma');
      prisma.recurringPaymentSchedule.findUnique.mockResolvedValue({
        id: 'schedule_1',
        destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        assetCode: 'XLM',
        amount: '10.0',
        cron: '0 0 * * *',
        status: 'ACTIVE',
        nextRunAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getSchedule('schedule_1', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');

      expect(result).toBeDefined();
      expect(prisma.recurringPaymentSchedule.findUnique).toHaveBeenCalledWith({
        where: { id: 'schedule_1' },
        include: { runs: { orderBy: { startedAt: 'desc' } } },
      });
    });
  });

  describe('updateSchedule', () => {
    it('should update a schedule', async () => {
      const { prisma } = require('../lib/prisma');
      prisma.recurringPaymentSchedule.update.mockResolvedValue({
        id: 'schedule_1',
        destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        assetCode: 'XLM',
        amount: '20.0',
        cron: '0 0 * * *',
        status: 'ACTIVE',
        nextRunAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.updateSchedule('schedule_1', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', {
        amount: '20.0',
      });

      expect(result).toBeDefined();
      expect(prisma.recurringPaymentSchedule.update).toHaveBeenCalled();
    });
  });

  describe('deleteSchedule', () => {
    it('should delete a schedule', async () => {
      const { prisma } = require('../lib/prisma');
      prisma.recurringPaymentSchedule.delete.mockResolvedValue({
        id: 'schedule_1',
        destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        assetCode: 'XLM',
        amount: '10.0',
        cron: '0 0 * * *',
        status: 'ACTIVE',
        nextRunAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.deleteSchedule('schedule_1', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');

      expect(prisma.recurringPaymentSchedule.delete).toHaveBeenCalledWith({
        where: { id: 'schedule_1' },
      });
    });
  });

  describe('processDueSchedules', () => {
    it('should process due schedules successfully', async () => {
      const { prisma } = require('../lib/prisma');
      const now = new Date('2026-04-26T12:00:00Z');
      
      prisma.recurringPaymentSchedule.findMany.mockResolvedValue([
        {
          id: 'schedule_1',
          destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          assetCode: 'XLM',
          amount: '10.0',
          cron: '0 0 * * *',
          status: 'ACTIVE',
          nextRunAt: new Date('2026-04-26T00:00:00Z'),
          user: { publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' },
        },
      ]);

      prisma.recurringPaymentRun.create.mockResolvedValue({
        id: 'run_1',
        status: 'PROCESSING',
        attempt: 1,
        startedAt: now,
      });

      prisma.$transaction.mockImplementation(async (callbacks) => {
        for (const cb of callbacks) {
          await cb();
        }
        return [];
      });

      const count = await service.processDueSchedules({ now });

      expect(count).toBe(1);
      expect(mockBatchPaymentService.executeBatch).toHaveBeenCalled();
    });

    it('should handle payment failures gracefully', async () => {
      const { prisma } = require('../lib/prisma');
      const now = new Date('2026-04-26T12:00:00Z');
      
      prisma.recurringPaymentSchedule.findMany.mockResolvedValue([
        {
          id: 'schedule_1',
          destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          assetCode: 'XLM',
          amount: '10.0',
          cron: '0 0 * * *',
          status: 'ACTIVE',
          nextRunAt: new Date('2026-04-26T00:00:00Z'),
          user: { publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' },
        },
      ]);

      prisma.recurringPaymentRun.create.mockResolvedValue({
        id: 'run_1',
        status: 'PROCESSING',
        attempt: 1,
        startedAt: now,
      });

      prisma.$transaction.mockImplementation(async (callbacks) => {
        for (const cb of callbacks) {
          await cb();
        }
        return [];
      });

      mockBatchPaymentService.executeBatch.mockRejectedValue(new Error('Payment failed'));

      const count = await service.processDueSchedules({ now });

      expect(count).toBe(1);
    });

    it('should respect limit parameter', async () => {
      const { prisma } = require('../lib/prisma');
      
      prisma.recurringPaymentSchedule.findMany.mockResolvedValue([]);

      await service.processDueSchedules({ limit: 10 });

      expect(prisma.recurringPaymentSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 })
      );
    });
  });
});
