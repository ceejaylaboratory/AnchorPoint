import { Worker, Job } from 'bullmq';
import { QUEUE_NAMES, defaultWorkerOptions, workerConcurrencyConfig } from '../config/queue';
import logger from '../utils/logger';

export interface WebhookJobData {
  url: string;
  payload: Record<string, unknown>;
}

export class WebhookQueueWorker {
  private worker: Worker<WebhookJobData> | null = null;

  async processJob(job: Job<WebhookJobData>): Promise<{ delivered: boolean }> {
    logger.info('Processing webhook job', { jobId: job.id, url: job.data.url });
    // Mock webhook sending logic
    await new Promise((resolve) => setTimeout(resolve, 150));
    logger.info('Webhook delivered successfully', { jobId: job.id });
    return { delivered: true };
  }

  start(): Worker<WebhookJobData> {
    if (!this.worker) {
      this.worker = new Worker<WebhookJobData>(
        QUEUE_NAMES.WEBHOOK_QUEUE,
        async (job) => this.processJob(job),
        {
          ...defaultWorkerOptions,
          concurrency: workerConcurrencyConfig[QUEUE_NAMES.WEBHOOK_QUEUE],
        }
      );

      this.worker.on('failed', (job, err) => {
        logger.error('Webhook queue worker job failed', { jobId: job?.id, error: err.message });
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

export const defaultWebhookQueueWorker = new WebhookQueueWorker();
