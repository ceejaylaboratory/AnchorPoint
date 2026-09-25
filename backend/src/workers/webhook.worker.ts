import { Worker, Job } from 'bullmq';
import { defaultQueueOptions, QUEUE_NAMES } from '../config/queue';
import logger from '../utils/logger';
import { setupWorkerGracefulShutdown } from './graceful-shutdown';
import {
  type WebhookRetryJobData,
  WEBHOOK_RETRY_JOB_OPTIONS,
} from '../services/webhookRetry.queue';
import {
  calculateFullJitterBackoff,
  signWebhookPayload,
  defaultWebhookService,
} from '../services/webhook.service';
import configService from '../services/config.service';

export interface WebhookAttemptRecord {
  jobId: string;
  transactionId: string;
  protocol: string;
  attempt: number;
  statusCode?: number;
  latencyMs: number;
  errorMessage?: string;
  timestamp: string;
  isDeadLetter: boolean;
}

export class WebhookWorker {
  private worker: Worker<WebhookRetryJobData> | null = null;
  public attemptHistories: WebhookAttemptRecord[] = [];

  constructor() {}

  /**
   * Process a single webhook retry job with backoff & latency tracking.
   */
  async processJob(job: Job<WebhookRetryJobData>): Promise<{
    delivered: boolean;
    attempt: number;
    statusCode?: number;
    latencyMs: number;
  }> {
    const {
      transactionId,
      protocol,
      callbackUrl,
      idempotencyKey,
      deliveryHash,
      payload,
      attempt,
    } = job.data;

    const startTime = Date.now();
    const cfg = configService.getConfig();
    const secret = cfg.WEBHOOK_SECRET || 'default-secret';
    const timestamp = Math.floor(startTime / 1000).toString();
    const signature = signWebhookPayload(payload, secret, timestamp);

    logger.info('Processing webhook retry attempt in WebhookWorker', {
      jobId: job.id,
      transactionId,
      protocol,
      attempt: job.attemptsMade + 1,
    });

    try {
      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Anchor-Signature': signature,
          'X-Anchor-Timestamp': timestamp,
          'Idempotency-Key': idempotencyKey,
        },
        body: payload,
        signal: AbortSignal.timeout(cfg.WEBHOOK_TIMEOUT_MS || 5000),
      });

      if (!response.ok) {
        throw new Error(`Webhook endpoint returned HTTP ${response.status}`);
      }

      const latencyMs = Date.now() - startTime;
      const record: WebhookAttemptRecord = {
        jobId: job.id || `job-${Date.now()}`,
        transactionId,
        protocol,
        attempt: job.attemptsMade + 1,
        statusCode: response.status,
        latencyMs,
        timestamp: new Date().toISOString(),
        isDeadLetter: false,
      };
      this.attemptHistories.push(record);

      logger.info('Webhook retry succeeded', {
        jobId: job.id,
        transactionId,
        latencyMs,
        statusCode: response.status,
      });

      return {
        delivered: true,
        attempt: job.attemptsMade + 1,
        statusCode: response.status,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts || 5);

      const record: WebhookAttemptRecord = {
        jobId: job.id || `job-${Date.now()}`,
        transactionId,
        protocol,
        attempt: job.attemptsMade + 1,
        latencyMs,
        errorMessage: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
        isDeadLetter: isLastAttempt,
      };
      this.attemptHistories.push(record);

      if (isLastAttempt) {
        this.fireDeadLetterAlert(record, callbackUrl);
      }

      logger.warn('Webhook retry failed in WebhookWorker', {
        jobId: job.id,
        transactionId,
        attempt: job.attemptsMade + 1,
        latencyMs,
        error: err instanceof Error ? err.message : String(err),
        isLastAttempt,
      });

      throw err;
    }
  }

  /**
   * Fires an alert when a webhook exhausts all retries and enters dead-letter state.
   */
  fireDeadLetterAlert(record: WebhookAttemptRecord, callbackUrl: string): void {
    logger.error('CRITICAL: Webhook permanently failed after max retries — moved to dead-letter queue', {
      transactionId: record.transactionId,
      protocol: record.protocol,
      attempts: record.attempt,
      lastError: record.errorMessage,
      callbackUrl,
    });
  }

  /**
   * Starts the BullMQ worker instance.
   */
  start(): Worker<WebhookRetryJobData> {
    if (!this.worker) {
      this.worker = new Worker<WebhookRetryJobData>(
        QUEUE_NAMES.WEBHOOK_DELIVERY,
        async (job) => {
          return this.processJob(job);
        },
        {
          ...defaultQueueOptions,
          concurrency: 5,
        }
      );

      this.worker.on('failed', (job, err) => {
        logger.error('Webhook worker job failed', {
          jobId: job?.id,
          error: err.message,
        });
      });
    }
    return this.worker;
  }

  /**
   * Closes worker connection.
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}

export const defaultWebhookWorker = new WebhookWorker();

// If executed directly as worker process
if (require.main === module) {
  logger.info('Webhook worker process started');
  const workerInstance = defaultWebhookWorker.start();
  setupWorkerGracefulShutdown(workerInstance, {
    workerName: 'Webhook worker',
    timeoutMs: 15000,
    onShutdown: async () => {
      await defaultWebhookWorker.close();
    },
  });
}
