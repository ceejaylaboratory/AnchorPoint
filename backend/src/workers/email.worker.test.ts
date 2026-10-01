import { Job } from 'bullmq';
import { EmailWorker, EmailJobData } from './email.worker';

describe('EmailWorker', () => {
  let worker: EmailWorker;

  beforeEach(() => {
    worker = new EmailWorker();
  });

  afterEach(async () => {
    await worker.close();
  });

  it('should process email job successfully', async () => {
    const mockJob = {
      id: 'job-1',
      data: {
        to: 'test@example.com',
        subject: 'Test',
        body: 'Hello',
      }
    } as unknown as Job<EmailJobData>;

    const result = await worker.processJob(mockJob);
    expect(result).toEqual({ delivered: true });
  });
});
