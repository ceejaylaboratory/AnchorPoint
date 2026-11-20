import cron from 'node-cron';
import logger from '../utils/logger';
import prisma from '../lib/prisma';
import { Sep24Service } from '../services/sep24.service';
import { config } from '../config/env';

export class Sep24Worker {
  /**
   * Process a specific SEP-24 transaction with a created claimable balance
   */
  async processDepositClaimable(
    transactionId: string,
    claimableBalanceId: string,
    callbackUrl?: string
  ): Promise<boolean> {
    try {
      logger.info('Processing SEP-24 claimable balance for transaction', {
        transactionId,
        claimableBalanceId,
      });

      // Update database transaction status to PENDING_EXTERNAL with
      // optimistic concurrency guard: the WHERE clause includes the current
      // status so the update only succeeds if no concurrent writer has changed
      // it since we last read it. A count of 0 means someone else already
      // moved the transaction — which is fine, not an error.
      try {
        const { count } = await prisma.transaction.updateMany({
          where: {
            id: transactionId,
            status: { notIn: ['PENDING_EXTERNAL', 'COMPLETED', 'ERROR'] },
          },
          data: {
            status: 'PENDING_EXTERNAL',
          },
        });
        if (count === 0) {
          logger.info('SEP-24 transaction already at terminal or target status, skipping', {
            transactionId,
          });
        }
      } catch (dbErr) {
        logger.warn('Database transaction update skipped or failed in worker', {
          transactionId,
          error: dbErr instanceof Error ? dbErr.message : String(dbErr),
        });
      }

      // Dispatch sep24.transaction.claimable webhook
      const delivery = await Sep24Service.notifyClaimableBalance(
        transactionId,
        claimableBalanceId,
        callbackUrl
      );

      logger.info('Dispatched claimable balance notification', {
        transactionId,
        claimableBalanceId,
        delivered: delivery.delivered,
        attempts: delivery.attempts,
      });

      return delivery.delivered;
    } catch (error) {
      logger.error('Error processing SEP-24 claimable deposit in worker', {
        transactionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Periodic check for deposits pending external redemption
   */
  async processPendingClaimableDeposits(): Promise<number> {
    try {
      // Find deposits that are pending external redemption or claimable
      const pendingDeposits = await prisma.transaction.findMany({
        where: {
          type: 'DEPOSIT',
          OR: [
            { status: 'PENDING_EXTERNAL' },
            {
              claimableBalanceId: { not: null },
              status: { notIn: ['COMPLETED', 'ERROR'] },
            },
          ],
        },
        take: 20,
      });

      let processedCount = 0;
      for (const tx of pendingDeposits) {
        const stored = await Sep24Service.getCallback(tx.id);
        // The payment path records the claimable balance ID on the transaction row
        const claimableBalanceId = stored?.claimableBalanceId ?? tx.claimableBalanceId;
        if (stored?.callbackUrl && claimableBalanceId) {
          if (tx.status === 'PENDING_EXTERNAL') {
            await Sep24Service.notifyClaimableBalance(
              tx.id,
              claimableBalanceId,
              stored.callbackUrl
            );
          } else {
            await this.processDepositClaimable(tx.id, claimableBalanceId, stored.callbackUrl);
          }
          processedCount++;
        }
      }

      return processedCount;
    } catch (error) {
      logger.error('Failed to process pending claimable deposits', error);
      return 0;
    }
  }
}

export const sep24Worker = new Sep24Worker();

export function startSep24Worker(): void {
  const cronSchedule = process.env.SEP24_WORKER_CRON || '*/1 * * * *';
  const validSchedule = cron.validate(cronSchedule) ? cronSchedule : '*/1 * * * *';

  cron.schedule(validSchedule, () => {
    sep24Worker
      .processPendingClaimableDeposits()
      .then((count) => {
        if (count > 0) {
          logger.info(`Processed ${count} SEP-24 claimable transactions`);
        }
      })
      .catch((err) => logger.error(`SEP-24 worker tick failed: ${(err as Error).message}`));
  });

  logger.info('🚀 SEP-24 claimable balance worker started');
  logger.info(`   Cron: ${validSchedule}`);
}

if (require.main === module) {
  startSep24Worker();
}
