import { Worker, Job } from 'bullmq';
import { QUEUE_NAMES, defaultWorkerOptions, workerConcurrencyConfig } from '../config/queue';
import logger from '../utils/logger';

export interface EmailJobData {
  to: string;
  subject: string;
  body: string;
}

export class EmailWorker {
  private worker: Worker<EmailJobData> | null = null;

  async processJob(job: Job<EmailJobData>): Promise<{ delivered: boolean }> {
    logger.info('Processing email job', { jobId: job.id, to: job.data.to });
    // Mock email sending logic
    await new Promise((resolve) => setTimeout(resolve, 100));
    logger.info('Email delivered successfully', { jobId: job.id });
    return { delivered: true };
  }

  start(): Worker<EmailJobData> {
    if (!this.worker) {
      this.worker = new Worker<EmailJobData>(
        QUEUE_NAMES.EMAIL_QUEUE,
        async (job) => this.processJob(job),
        {
          ...defaultWorkerOptions,
          concurrency: workerConcurrencyConfig[QUEUE_NAMES.EMAIL_QUEUE],
        }
      );

      this.worker.on('failed', (job, err) => {
        logger.error('Email worker job failed', { jobId: job?.id, error: err.message });
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

export const defaultEmailWorker = new EmailWorker();
