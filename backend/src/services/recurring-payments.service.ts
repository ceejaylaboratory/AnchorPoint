import cronParser from 'cron-parser';
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { isValidStellarPublicKey } from '../utils/stellar-address';
import { BatchPaymentService } from './batch-payment.service';
import { BatchErrorType, BatchPaymentError } from './batch-payment.types';
import { config } from '../config/env';
import { notificationService } from './notification.service';

export type RecurringPaymentScheduleInput = {
  destination: string;
  assetCode: string;
  amount: string;
  cron: string;
};

export type RecurringPaymentErrorType =
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_CONFIG'
  | 'PAYMENT_FAILED';

export class RecurringPaymentError extends Error {
  readonly type: RecurringPaymentErrorType;

  constructor(type: RecurringPaymentErrorType, message: string) {
    super(message);
    this.name = 'RecurringPaymentError';
    this.type = type;
  }
}

export type RecurringPaymentFailureKind = 'TRANSIENT' | 'PERMANENT';

/** Batch error types that will fail identically on every retry. */
const PERMANENT_BATCH_ERROR_TYPES = new Set<BatchErrorType>([
  BatchErrorType.EXCEEDS_MAX_OPS,
  BatchErrorType.INVALID_ADDRESS,
  BatchErrorType.INSUFFICIENT_BALANCE,
  BatchErrorType.SEQUENCE_CONFLICT,
  BatchErrorType.INVALID_ASSET,
]);

/** Horizon result codes that indicate a deterministic rejection. */
const PERMANENT_RESULT_CODES = new Set([
  'tx_bad_seq',
  'tx_bad_auth',
  'tx_bad_auth_extra',
  'tx_insufficient_balance',
  'tx_no_source_account',
  'tx_malformed',
  'tx_not_supported',
  'op_underfunded',
  'op_no_destination',
  'op_no_trust',
  'op_not_authorized',
  'op_line_full',
  'op_no_issuer',
  'op_malformed',
  'op_src_no_trust',
  'op_src_not_authorized',
  'op_bad_auth',
  'op_no_account',
]);

/** Horizon result codes that may succeed if the same payment is resubmitted later. */
const TRANSIENT_RESULT_CODES = new Set(['tx_insufficient_fee', 'tx_too_late', 'tx_internal_error']);

/** Node / axios socket-level error codes. */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_NETWORK',
]);

type ErrorLike = {
  code?: unknown;
  status?: unknown;
  name?: unknown;
  details?: { error?: unknown };
  cause?: unknown;
  extras?: { result_codes?: { transaction?: string; operations?: string[] } };
  response?: {
    status?: unknown;
    extras?: { result_codes?: { transaction?: string; operations?: string[] } };
    data?: { status?: unknown; extras?: { result_codes?: { transaction?: string; operations?: string[] } } };
  };
};

function collectResultCodes(err: ErrorLike): string[] {
  const resultCodes =
    err.extras?.result_codes ?? err.response?.extras?.result_codes ?? err.response?.data?.extras?.result_codes;
  if (!resultCodes) return [];
  const codes = [...(resultCodes.operations ?? [])];
  if (resultCodes.transaction) codes.push(resultCodes.transaction);
  return codes.filter((code) => code !== 'op_success');
}

function extractHttpStatus(err: ErrorLike): number | undefined {
  const status = err.response?.status ?? err.response?.data?.status ?? err.status;
  return typeof status === 'number' ? status : undefined;
}

function classifyHttpStatus(status: number): RecurringPaymentFailureKind | undefined {
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'TRANSIENT';
  if (status >= 400) return 'PERMANENT';
  return undefined;
}

/**
 * Classifies a recurring payment failure as transient (worth retrying with
 * backoff: network faults, timeouts, rate limits, Horizon 5xx) or permanent
 * (will fail identically on retry: bad sequence, insufficient balance, invalid
 * destination/asset, missing configuration).
 *
 * Errors that cannot be classified default to TRANSIENT so that retries stay
 * bounded by RECURRING_PAYMENTS_MAX_RETRIES rather than dropping an occurrence
 * on an unrecognised blip.
 */
export function classifyRecurringPaymentError(error: unknown, depth = 0): RecurringPaymentFailureKind {
  if (error instanceof RecurringPaymentError) {
    return 'PERMANENT';
  }

  if (!error || typeof error !== 'object' || depth > 3) {
    return 'TRANSIENT';
  }

  const err = error as ErrorLike;

  if (error instanceof BatchPaymentError) {
    if (PERMANENT_BATCH_ERROR_TYPES.has(error.type)) return 'PERMANENT';
    if (error.type === BatchErrorType.NETWORK_ERROR) return 'TRANSIENT';
  }

  const resultCodes = collectResultCodes(err);
  if (resultCodes.some((code) => PERMANENT_RESULT_CODES.has(code))) return 'PERMANENT';
  if (resultCodes.some((code) => TRANSIENT_RESULT_CODES.has(code))) return 'TRANSIENT';

  const status = extractHttpStatus(err);
  const statusKind = status !== undefined ? classifyHttpStatus(status) : undefined;
  if (statusKind) return statusKind;

  if (typeof err.code === 'string' && TRANSIENT_NETWORK_CODES.has(err.code)) return 'TRANSIENT';

  // Unwrap errors that carry the underlying Horizon / network failure.
  const inner = err.details?.error ?? err.cause;
  if (inner && inner !== error) {
    return classifyRecurringPaymentError(inner, depth + 1);
  }

  if (err.name === 'NotFoundError') return 'PERMANENT';

  return 'TRANSIENT';
}

/** Fixed delay before retrying an insufficient-funds failure (issue #935). */
const INSUFFICIENT_FUNDS_RETRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/** A schedule failing this many consecutive times triggers a user notification. */
const FAILURE_NOTIFICATION_THRESHOLD = 2;

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

  /**
   * Pre-flight balance check: confirm the distribution (payer) account holds
   * enough of `assetCode` to cover `amount` before any payment is queued or
   * executed.
   *
   * Returns `true` when the balance covers the amount. Throws a
   * {@link RecurringPaymentError} of type `INSUFFICIENT_FUNDS` when it does not
   * (so callers can classify the failure and schedule the 24h retry).
   *
   * When the payer secret is not configured, the check is skipped and the
   * caller proceeds to execution (the batch service reports the real error).
   */
  async checkSufficientBalance(params: {
    amount: string;
    assetCode: string;
    sourceSecretKey?: string;
  }): Promise<boolean> {
    const sourceSecretKey = params.sourceSecretKey ?? config.STELLAR_DISTRIBUTION_SECRET;
    if (!sourceSecretKey) {
      return true;
    }

    const sourceKeypair = Keypair.fromSecret(sourceSecretKey);
    const sourcePublicKey = sourceKeypair.publicKey();

    const server = new Horizon.Server(config.STELLAR_HORIZON_URL);
    const account = await server.loadAccount(sourcePublicKey);

    const required = Number.parseFloat(params.amount);
    const isNative =
      params.assetCode === 'XLM' || params.assetCode === 'native' || !params.assetCode;

    let available = 0;
    for (const balance of account.balances) {
      if (isNative && balance.asset_type === 'native') {
        available = Number.parseFloat(balance.balance);
        break;
      }
      if (
        !isNative &&
        (balance.asset_type === 'credit_alphanum4' || balance.asset_type === 'credit_alphanum12') &&
        balance.asset_code === params.assetCode
      ) {
        available = Number.parseFloat(balance.balance);
        break;
      }
    }

    if (available < required) {
      logger.warn('Recurring payment pre-flight balance check failed', {
        sourcePublicKey,
        assetCode: params.assetCode,
        available,
        required,
      });
      throw new RecurringPaymentError(
        'INSUFFICIENT_FUNDS',
        `Insufficient balance in distribution account: ${available} ${params.assetCode} available, ${params.amount} required`
      );
    }

    return true;
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

        // A run re-queued after a transient failure is picked up again rather
        // than creating a new run row for the same occurrence.
        const requeuedRun = await tx.recurringPaymentRun.findFirst({
          where: { scheduleId: schedule.id, status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
        });

        if (requeuedRun) {
          return tx.recurringPaymentRun.update({
            where: { id: requeuedRun.id },
            data: {
              status: 'PROCESSING',
              attempt,
              startedAt: new Date(),
              finishedAt: null,
            },
          });
        }

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
          throw new RecurringPaymentError('INVALID_CONFIG', 'STELLAR_DISTRIBUTION_SECRET is not configured');
        }

        // Pre-flight balance check before execution. Insufficient funds is
        // classified separately (see catch below) and schedules a fixed 24h
        // retry instead of a generic backoff failure.
        await this.checkSufficientBalance({
          amount: schedule.amount,
          assetCode: schedule.assetCode,
          sourceSecretKey,
        });

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

        // Insufficient funds gets a fixed 24h retry (a funding problem is not
        // resolved by exponential backoff) and a dedicated run status so the
        // failure is distinguishable from a generic payment error.
        const isInsufficientFunds =
          error instanceof RecurringPaymentError && error.type === 'INSUFFICIENT_FUNDS';

        // Only transient failures (network faults, timeouts, rate limits) are
        // worth retrying; permanent ones (bad sequence, bad balance, invalid
        // destination or config) would fail identically on every attempt.
        const failureKind = classifyRecurringPaymentError(error);
        const shouldRetry = failureKind === 'TRANSIENT' && failedAttempt <= maxRetries;

        let nextRunAt: Date;
        let nextRetryCount: number;
        let runStatus: 'FAILED' | 'INSUFFICIENT_FUNDS' | 'PENDING' = 'FAILED';

        if (isInsufficientFunds) {
          nextRunAt = new Date(now.getTime() + INSUFFICIENT_FUNDS_RETRY_MS);
          nextRetryCount = failedAttempt;
          runStatus = 'INSUFFICIENT_FUNDS';
          logger.warn('Recurring payment run failed; insufficient funds, retrying in 24h', {
            scheduleId: schedule.id,
            runId: run.id,
            attempt: failedAttempt,
            nextRunAt: nextRunAt.toISOString(),
            error: message,
          });
        } else if (shouldRetry) {
          // Re-queue the run: it stays PENDING and is picked up again by the
          // next tick once the backoff delay has elapsed.
          const delayMs = this.computeBackoffDelayMs(failedAttempt);
          nextRunAt = new Date(now.getTime() + delayMs);
          nextRetryCount = failedAttempt;
          runStatus = 'PENDING';
          logger.warn('Recurring payment run failed with a transient error; scheduling backoff retry', {
            scheduleId: schedule.id,
            runId: run.id,
            attempt: failedAttempt,
            maxRetries,
            delayMs,
            nextRunAt: nextRunAt.toISOString(),
            error: message,
          });
        } else {
          // Permanent failure or retries exhausted: mark FAILED, reset retry
          // state and wait for the next cron occurrence.
          nextRunAt = this.computeNextRunAt(schedule.cron, now);
          nextRetryCount = 0;
          logger.error(
            failureKind === 'PERMANENT'
              ? 'Recurring payment run failed with a permanent error; not retrying'
              : 'Recurring payment run failed; retries exhausted',
            {
              scheduleId: schedule.id,
              runId: run.id,
              attempt: failedAttempt,
              maxRetries,
              failureKind,
              nextRunAt: nextRunAt.toISOString(),
              error: message,
            }
          );
        }

        await prisma.$transaction([
          prisma.recurringPaymentRun.update({
            where: { id: run.id },
            data: {
              status: runStatus,
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

        // Notify the user when a payment has failed twice consecutively.
        // A re-queued transient failure is not yet a failed payment.
        if (runStatus !== 'PENDING') {
          const recentFailedRuns = await prisma.recurringPaymentRun.count({
            where: {
              scheduleId: schedule.id,
              status: { in: ['FAILED', 'INSUFFICIENT_FUNDS'] },
            },
          });

          if (recentFailedRuns >= FAILURE_NOTIFICATION_THRESHOLD) {
            await notificationService.notify(
              schedule.userId,
              `Recurring payment of ${schedule.amount} ${schedule.assetCode} to ${schedule.destination} has failed ${recentFailedRuns} times. Please check your funding source.`,
              run.id
            );
          }
        }

        processed += 1;
      }
    }

    return processed;
  }
}
