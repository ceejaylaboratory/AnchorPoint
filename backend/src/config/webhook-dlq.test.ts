import type { Job } from 'bullmq';
import {
  QUEUE_NAMES,
  routeFailedWebhookToDlq,
  retryWebhookDlqJob,
  retryFailedWebhooks,
  type WebhookDeadLetterData,
} from './queue';
import type { WebhookRetryJobData } from '../services/webhookRetry.queue';
import * as dlqMetrics from './webhook-dlq-metrics';
import { metricsService } from '../services/metrics.service';

const jobData: WebhookRetryJobData = {
  protocol: 'sep24',
  transactionId: 'tx-1',
  previousStatus: 'PENDING',
  nextStatus: 'COMPLETED',
  callbackUrl: 'https://partner.example/webhook',
  idempotencyKey: 'sep24:tx-1:PENDING->COMPLETED',
  deliveryHash: 'hash-1',
  payload: '{"event":"transaction.status_changed"}',
  attempt: 5,
};

function makeJob(attemptsMade: number): Job<WebhookRetryJobData> {
  return {
    id: 'job-1',
    name: 'webhook-retry',
    data: jobData,
    attemptsMade,
    opts: { attempts: 5 },
  } as unknown as Job<WebhookRetryJobData>;
}

describe('Webhook dead-letter queue (#1584)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses a dedicated DLQ queue name', () => {
    expect(QUEUE_NAMES.WEBHOOK_DELIVERY_DLQ).toBe('webhook-delivery-dlq');
    expect(metricsService.getRegistry().getSingleMetric('webhook_dlq_count')).toBeDefined();
  });

  it('dead-letters only exhausted jobs with full diagnostics', async () => {
    jest.spyOn(dlqMetrics, 'incrementWebhookDlqCount');
    const add = jest.fn().mockResolvedValue({ id: 'dlq-1' });
    expect(await routeFailedWebhookToDlq(makeJob(2), new Error('temporary'), {}, { add })).toBe(false);

    const routed = await routeFailedWebhookToDlq(
      makeJob(5),
      new Error('Webhook endpoint returned HTTP 503'),
      { status: 503, body: 'Service Unavailable' },
      { add }
    );

    expect(routed).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
    const deadLetter = add.mock.calls[0][1] as WebhookDeadLetterData;
    expect(deadLetter.responseStatus).toBe(503);
    expect(deadLetter.responseBody).toBe('Service Unavailable');
    expect(deadLetter.attemptsMade).toBe(5);
    expect(deadLetter.data).toEqual(jobData);
    expect(dlqMetrics.incrementWebhookDlqCount).toHaveBeenCalledTimes(1);
  });

  it('re-enqueues a dead-lettered job and removes it from the DLQ', async () => {
    jest.spyOn(dlqMetrics, 'decrementWebhookDlqCount');
    const remove = jest.fn().mockResolvedValue(undefined);
    const job = { id: 'dlq-1', data: { name: 'webhook-retry', data: jobData }, remove } as unknown as Job<WebhookDeadLetterData>;
    const getJob = jest.fn().mockResolvedValue(job);
    const add = jest.fn().mockResolvedValue({ id: 'redelivered-1' });
    const retried = await retryWebhookDlqJob('dlq-1', { getJob }, { add });

    expect(retried?.id).toBe('redelivered-1');
    expect(add).toHaveBeenCalledWith('webhook-retry', jobData, expect.objectContaining({ attempts: 5 }));
    expect(remove).toHaveBeenCalled();
    expect(dlqMetrics.decrementWebhookDlqCount).toHaveBeenCalledTimes(1);
  });

  it('supports single and bulk redelivery through one helper', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const dlqJobs = [1, 2].map(
      (n) =>
        ({
          id: `dlq-${n}`,
          data: { name: 'webhook-retry', data: { ...jobData, transactionId: `tx-${n}` } },
          remove,
        }) as unknown as Job<WebhookDeadLetterData>
    );
    const getJob = jest.fn().mockImplementation((id: string) =>
      Promise.resolve(dlqJobs.find((job) => job.id === id))
    );
    const getJobs = jest.fn().mockResolvedValue(dlqJobs);
    const add = jest.fn().mockImplementation((_name, data) => Promise.resolve({ id: `retry-${data.transactionId}` }));

    expect(await retryFailedWebhooks('dlq-1', 50, { getJob, getJobs }, { add })).toEqual(['retry-tx-1']);
    expect(await retryFailedWebhooks(undefined, 2, { getJob, getJobs }, { add })).toEqual([
      'retry-tx-1',
      'retry-tx-2',
    ]);
    expect(getJobs).toHaveBeenCalledWith(['waiting', 'delayed', 'paused'], 0, 1);
  });
});
