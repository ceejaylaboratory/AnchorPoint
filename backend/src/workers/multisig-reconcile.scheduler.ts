import cron, { ScheduledTask } from 'node-cron';
import multisigService from '../services/multisig.service';
import logger from '../utils/logger';

/**
 * #1527: Periodically re-evaluates every multisig transaction that is still
 * collecting signatures against its current threshold, so a transaction whose
 * threshold changed after signatures were collected does not stay stuck in
 * PENDING / PARTIALLY_SIGNED (or incorrectly READY) forever.
 */
export class MultisigReconcileScheduler {
  private task: ScheduledTask | null = null;

  start(): void {
    this.task = cron.schedule('*/5 * * * *', async () => {
      try {
        await this.reconcile();
      } catch (error) {
        logger.error('Failed to run multisig reconciliation task', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    logger.info('Multisig reconciliation scheduler started (running every 5 minutes)');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    logger.info('Multisig reconciliation scheduler stopped');
  }

  async reconcile(): Promise<number> {
    const { checked, updated, failed } = await multisigService.reconcilePendingTransactions();

    if (updated > 0 || failed > 0) {
      logger.info(
        `Multisig reconciliation checked ${checked} transactions: ${updated} updated, ${failed} failed`
      );
    }
    return updated;
  }
}

export const multisigReconcileScheduler = new MultisigReconcileScheduler();
