import cron, { ScheduledTask } from 'node-cron';
import prisma from '../lib/prisma';
import { stellarService } from '../services/stellar.service';
import { metricsService } from '../services/metrics.service';
import { emitTransactionStatusUpdate } from '../lib/socket';
import logger from '../utils/logger';

/** Transactions must have been pending for at least this long before reconciling. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * #1342: Re-queries Horizon for transactions stuck in `pending_stellar` (e.g.
 * because a confirmation was missed) and moves them to `completed` or `error`
 * based on the on-chain result.
 */
export class TransactionReconcileScheduler {
  private task: ScheduledTask | null = null;

  start(): void {
    this.task = cron.schedule('*/10 * * * *', async () => {
      try {
        await this.reconcile();
      } catch (error) {
        logger.error('Failed to run transaction reconciliation task', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    logger.info('Transaction reconciliation scheduler started (running every 10 minutes)');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    logger.info('Transaction reconciliation scheduler stopped');
  }

  async reconcile(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    const pending = await prisma.transaction.findMany({
      where: {
        status: 'pending_stellar',
        updatedAt: { lt: cutoff },
        stellarTxId: { not: null },
      },
    });

    const server = stellarService.getHorizonServer();
    let reconciled = 0;

    for (const tx of pending) {
      try {
        const record = await server.transactions().transaction(tx.stellarTxId as string).call();

        if (record.successful) {
          const updated = await prisma.transaction.update({
            where: { id: tx.id },
            data: { status: 'completed', sep31Status: 'completed', completedAt: new Date() },
          });
          metricsService.incrementTransactionReconciliation('completed');
          emitTransactionStatusUpdate(tx.userId, {
            id: updated.id,
            status: updated.status,
            updated_at: updated.updatedAt,
            stellar_transaction_id: updated.stellarTxId,
          });
        } else {
          const updated = await prisma.transaction.update({
            where: { id: tx.id },
            data: {
              status: 'error',
              sep31Status: 'error',
              requiredInfoMessage: 'Stellar transaction failed on the network',
            },
          });
          metricsService.incrementTransactionReconciliation('error');
          emitTransactionStatusUpdate(tx.userId, {
            id: updated.id,
            status: updated.status,
            updated_at: updated.updatedAt,
            stellar_transaction_id: updated.stellarTxId,
          });
        }

        reconciled++;
      } catch (error) {
        const statusCode = (error as { response?: { status?: number } })?.response?.status;
        if (statusCode === 404) {
          // Not on the ledger yet; leave it pending for the next run.
          metricsService.incrementTransactionReconciliation('not_found');
          continue;
        }
        metricsService.incrementTransactionReconciliation('failed');
        logger.error('Transaction reconciliation failed', {
          transactionId: tx.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    if (reconciled > 0) {
      logger.info(`Reconciled ${reconciled} pending_stellar transactions against Horizon`);
    }
    return reconciled;
  }
}

export const transactionReconcileScheduler = new TransactionReconcileScheduler();
