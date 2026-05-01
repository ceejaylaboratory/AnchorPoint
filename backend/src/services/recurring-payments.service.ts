import cronParser from 'cron-parser';
import { StrKey } from '@stellar/stellar-sdk';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { BatchPaymentService } from './batch-payment.service';
import { config } from '../config/env';

export type RecurringPaymentScheduleInput = {
  destination: string;
  assetCode: string;
  amount: string;
  cron: string;
};

export class RecurringPaymentsService {
  private readonly batchPaymentService: BatchPaymentService;

  constructor(batchPaymentService?: BatchPaymentService) {
    this.batchPaymentService =
      batchPaymentService ??
      new BatchPaymentService({
        horizonUrl: config.STELLAR_HORIZON_URL,
        networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
      });
  }

  computeNextRunAt(cron: string, fromDate: Date = new Date()): Date {
    const interval = cronParser.parseExpression(cron, {
      currentDate: fromDate,
      tz: 'UTC',
    });
    return interval.next().toDate();
  }

  validateScheduleInput(input: RecurringPaymentScheduleInput): void {
    if (!StrKey.isValidEd25519PublicKey(input.destination)) {
      throw new Error('Invalid destination Stellar address');
    }

    const amountNum = Number.parseFloat(input.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new Error('Amount must be a positive number');
    }

    try {
      this.computeNextRunAt(input.cron);
    } catch (e) {
      throw new Error('Invalid cron expression');
    }
  }

  async createSchedule(userPublicKey: string, input: RecurringPaymentScheduleInput) {
    this.validateScheduleInput(input);

    const nextRunAt = this.computeNextRunAt(input.cron);

    const schedule = await prisma.recurringPaymentSchedule.create({
      data: {
        user: {
          connect: {
            publicKey: userPublicKey,
          },
        },
        destination: input.destination,
        assetCode: input.assetCode,
        amount: input.amount,
        cron: input.cron,
        status: 'ACTIVE',
        nextRunAt,
      },
    });

    return schedule;
  }

  async listSchedules(userPublicKey: string) {
    return prisma.recurringPaymentSchedule.findMany({
      where: {
        user: {
          publicKey: userPublicKey,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async updateScheduleStatus(userPublicKey: string, scheduleId: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED') {
    const schedule = await prisma.recurringPaymentSchedule.findFirst({
      where: {
        id: scheduleId,
        user: {
          publicKey: userPublicKey,
        },
      },
    });

    if (!schedule) {
      throw new Error('Schedule not found');
    }

    const data: Record<string, unknown> = {
      status,
    };

    if (status === 'ACTIVE') {
      data.nextRunAt = this.computeNextRunAt(schedule.cron);
    }

    return prisma.recurringPaymentSchedule.update({
      where: { id: scheduleId },
      data,
    });
  }

  async deleteSchedule(userPublicKey: string, scheduleId: string) {
    const schedule = await prisma.recurringPaymentSchedule.findFirst({
      where: {
        id: scheduleId,
        user: {
          publicKey: userPublicKey,
        },
      },
    });

    if (!schedule) {
      throw new Error('Schedule not found');
    }

    await prisma.recurringPaymentRun.deleteMany({
      where: {
        scheduleId,
      },
    });

    await prisma.recurringPaymentSchedule.delete({
      where: { id: scheduleId },
    });
  }

  async processDueSchedules(params: { now?: Date; limit?: number } = {}): Promise<number> {
    const now = params.now ?? new Date();
    const limit = params.limit ?? 25;

    const dueSchedules = await prisma.recurringPaymentSchedule.findMany({
      where: {
        status: 'ACTIVE',
        nextRunAt: {
          lte: now,
        },
      },
      take: limit,
      orderBy: {
        nextRunAt: 'asc',
      },
      include: {
        user: {
          select: {
            publicKey: true,
          },
        },
      },
    });

    let processed = 0;

    for (const schedule of dueSchedules) {
      const run = await prisma.recurringPaymentRun.create({
        data: {
          schedule: {
            connect: {
              id: schedule.id,
            },
          },
          status: 'PROCESSING',
          attempt: 1,
          startedAt: new Date(),
        },
      });

      try {
        const sourceSecretKey = config.STELLAR_DISTRIBUTION_SECRET;
        if (!sourceSecretKey) {
          throw new Error('STELLAR_DISTRIBUTION_SECRET is not configured');
        }

        const result = await this.batchPaymentService.executeBatch({
          payments: [
            {
              destination: schedule.destination,
              amount: schedule.amount,
              assetCode: schedule.assetCode,
            },
          ],
          sourceSecretKey,
        });

        const nextRunAt = this.computeNextRunAt(schedule.cron, now);

        await prisma.$transaction([
          prisma.recurringPaymentRun.update({
            where: { id: run.id },
            data: {
              status: 'SUCCEEDED',
              stellarTxId: result.transactionHash,
              finishedAt: new Date(),
            },
          }),
          prisma.recurringPaymentSchedule.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: now,
              nextRunAt,
            },
          }),
        ]);

        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Recurring payment run failed', {
          scheduleId: schedule.id,
          runId: run.id,
          error: message,
        });

        const nextRunAt = this.computeNextRunAt(schedule.cron, now);

        await prisma.$transaction([
          prisma.recurringPaymentRun.update({
            where: { id: run.id },
            data: {
              status: 'FAILED',
              error: message,
              finishedAt: new Date(),
            },
          }),
          prisma.recurringPaymentSchedule.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: now,
              nextRunAt,
            },
          }),
        ]);

        processed += 1;
      }
    }

    return processed;
  }
}
