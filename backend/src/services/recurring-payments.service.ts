import cronParser from 'cron-parser';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { isValidStellarPublicKey } from '../utils/stellar-address';
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

  /**
   * Computes the exponential backoff delay (in milliseconds) before the given
   * retry attempt. `attempt` is 1-based: attempt 1 is the first retry after an
   * initial failure.
   *
   * delay = min(base * multiplier^(attempt-1), maxDelay), with optional
   * +/- jitter to spread out retries across many schedules.
   */
  computeBackoffDelayMs(attempt: number): number {
    const base = config.RECURRING_PAYMENTS_BACKOFF_BASE_MS;
    const multiplier = config.RECURRING_PAYMENTS_BACKOFF_MULTIPLIER;
    const maxDelay = config.RECURRING_PAYMENTS_BACKOFF_MAX_MS;
    const jitter = config.RECURRING_PAYMENTS_BACKOFF_JITTER;

    const safeAttempt = Math.max(1, Math.floor(attempt));
    const raw = base * Math.pow(multiplier, safeAttempt - 1);
    const capped = Math.min(raw, maxDelay);

    if (jitter <= 0) {
      return Math.round(capped);
    }

    // Apply symmetric jitter in the range [-jitter, +jitter].
    const jitterFactor = 1 + (Math.random() * 2 - 1) * jitter;
    const withJitter = capped * jitterFactor;

    // Clamp to [0, maxDelay] so jitter can never exceed the configured ceiling.
    return Math.round(Math.min(Math.max(withJitter, 0), maxDelay));
  }

  validateScheduleInput(input: RecurringPaymentScheduleInput): void {
    if (!isValidStellarPublicKey(input.destination)) {
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

  async getSchedule(scheduleId: string, userPublicKey: string) {
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

    return prisma.recurringPaymentSchedule.findUnique({
      where: { id: scheduleId },
      include: { runs: { orderBy: { startedAt: 'desc' } } },
    });
  }

  async updateSchedule(scheduleId: string, userPublicKey: string, input: Partial<RecurringPaymentScheduleInput>) {
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

    const updatedInput = {
      destination: input.destination ?? schedule.destination,
      assetCode: input.assetCode ?? schedule.assetCode,
      amount: input.amount ?? schedule.amount,
      cron: input.cron ?? schedule.cron,
    };

    this.validateScheduleInput(updatedInput);

    const data: Record<string, unknown> = {
      ...input,
    };

    if (input.cron) {
      data.nextRunAt = this.computeNextRunAt(input.cron);
    }

    return prisma.recurringPaymentSchedule.update({
      where: { id: scheduleId },
      data,
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
      // Atomic schedule fetch & status lock inside prisma.$transaction to prevent concurrent worker race conditions
      const claim = await prisma.$transaction(async (tx) => {
        const currentSchedule = await tx.recurringPaymentSchedule.findUnique({
          where: { id: schedule.id },
        });

        // Skip if there is already an in-flight run for this schedule.
        // We detect this by checking if an ACTIVE run exists rather than
        // setting an invalid 'PROCESSING' status on the schedule itself
        // (RecurringPaymentScheduleStatus only has ACTIVE | PAUSED | CANCELLED).
        if (!currentSchedule || currentSchedule.status !== 'ACTIVE') {
          return null;
        }

        // No status flip needed on the schedule — just record the run.
        const attempt = (currentSchedule.retryCount ?? 0) + 1;

        const run = await tx.recurringPaymentRun.create({
          data: {
            schedule: {
              connect: {
                id: schedule.id,
              },
            },
            status: 'PROCESSING',
            attempt,
            startedAt: new Date(),
          },
        });

        return run;
      });

      if (!claim) {
        continue;
      }

      const run = claim;

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
              status: 'ACTIVE',
              lastRunAt: now,
              // Successful run clears any accumulated retry state.
              retryCount: 0,
              nextRunAt,
            },
          }),
        ]);

        processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // `run.attempt` is the attempt number that just failed (1-based).
        const failedAttempt = run.attempt;
        const maxRetries = config.RECURRING_PAYMENTS_MAX_RETRIES;

        // Decide whether to retry this occurrence with exponential backoff or
        // give up and defer to the next cron-scheduled run.
        const shouldRetry = failedAttempt <= maxRetries;

        let nextRunAt: Date;
        let nextRetryCount: number;

        if (shouldRetry) {
          const delayMs = this.computeBackoffDelayMs(failedAttempt);
          nextRunAt = new Date(now.getTime() + delayMs);
          nextRetryCount = failedAttempt;
          logger.warn('Recurring payment run failed; scheduling backoff retry', {
            scheduleId: schedule.id,
            runId: run.id,
            attempt: failedAttempt,
            maxRetries,
            delayMs,
            nextRunAt: nextRunAt.toISOString(),
            error: message,
          });
        } else {
          // Retries exhausted: reset state and wait for the next cron occurrence.
          nextRunAt = this.computeNextRunAt(schedule.cron, now);
          nextRetryCount = 0;
          logger.error('Recurring payment run failed; retries exhausted', {
            scheduleId: schedule.id,
            runId: run.id,
            attempt: failedAttempt,
            maxRetries,
            nextRunAt: nextRunAt.toISOString(),
            error: message,
          });
        }

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
              status: 'ACTIVE',
              lastRunAt: now,
              retryCount: nextRetryCount,
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
