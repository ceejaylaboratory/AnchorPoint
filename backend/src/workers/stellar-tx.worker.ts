import { Worker, Job } from 'bullmq';
import { QUEUE_NAMES, defaultWorkerOptions, workerConcurrencyConfig } from '../config/queue';
import logger from '../utils/logger';

export interface StellarTxJobData {
  transactionXdr: string;
  networkPassphrase?: string;
}

export class StellarTxWorker {
  private worker: Worker<StellarTxJobData> | null = null;

  async processJob(job: Job<StellarTxJobData>): Promise<{ hash: string }> {
    logger.info('Processing stellar tx job', { jobId: job.id });
    // Mock stellar tx submitting logic
    await new Promise((resolve) => setTimeout(resolve, 200));
    const mockHash = 'mock_tx_hash_' + Date.now();
    logger.info('Stellar tx submitted successfully', { jobId: job.id, hash: mockHash });
    return { hash: mockHash };
  }

  start(): Worker<StellarTxJobData> {
    if (!this.worker) {
      this.worker = new Worker<StellarTxJobData>(
        QUEUE_NAMES.STELLAR_TX_QUEUE,
        async (job) => this.processJob(job),
        {
          ...defaultWorkerOptions,
          concurrency: workerConcurrencyConfig[QUEUE_NAMES.STELLAR_TX_QUEUE],
        }
      );

      this.worker.on('failed', (job, err) => {
        logger.error('Stellar tx worker job failed', { jobId: job?.id, error: err.message });
      });
    }
    return this.worker;
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}

export const defaultStellarTxWorker = new StellarTxWorker();
