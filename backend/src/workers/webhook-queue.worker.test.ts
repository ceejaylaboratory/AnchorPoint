import { Job } from 'bullmq';
import { WebhookQueueWorker, WebhookJobData } from './webhook-queue.worker';

describe('WebhookQueueWorker', () => {
  let worker: WebhookQueueWorker;

  beforeEach(() => {
    worker = new WebhookQueueWorker();
  });

  afterEach(async () => {
    await worker.close();
  });

  it('should process webhook job successfully', async () => {
    const mockJob = {
      id: 'job-wh-1',
      data: {
        url: 'https://example.com/webhook',
        payload: { event: 'tx_success' },
      }
    } as unknown as Job<WebhookJobData>;

    const result = await worker.processJob(mockJob);
    expect(result).toEqual({ delivered: true });
  });
});
