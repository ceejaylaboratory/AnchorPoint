import { Job } from 'bullmq';
import {
  queueConnection,
  QUEUE_NAMES,
  notificationQueueOptions,
  routeFailedNotificationToDlq,
  retryNotificationDlqJob,
} from './queue';

describe('BullMQ queue connection resiliency (#361)', () => {
  it('has maxRetriesPerRequest set to null for BullMQ compatibility', () => {
    expect(queueConnection.maxRetriesPerRequest).toBeNull();
  });

  it('has enableReadyCheck disabled', () => {
    expect(queueConnection.enableReadyCheck).toBe(false);
  });

  it('retryStrategy returns capped delay', () => {
    const strategy = queueConnection.retryStrategy as (times: number) => number;
    expect(strategy(1)).toBe(100);
    expect(strategy(10)).toBe(1000);
    expect(strategy(100)).toBe(5000);
  });

  it('reconnectOnError returns true for READONLY errors', () => {
    const fn = queueConnection.reconnectOnError as (err: Error) => boolean;
    expect(fn(new Error('READONLY command not allowed'))).toBe(true);
  });

  it('reconnectOnError returns true for ECONNRESET errors', () => {
    const fn = queueConnection.reconnectOnError as (err: Error) => boolean;
    expect(fn(new Error('ECONNRESET'))).toBe(true);
  });

  it('reconnectOnError returns false for unrelated errors', () => {
    const fn = queueConnection.reconnectOnError as (err: Error) => boolean;
    expect(fn(new Error('WRONGTYPE'))).toBe(false);
  });
});

describe('Notification dead-letter queue (#1199)', () => {
  const makeJob = (overrides: Partial<Job> = {}) =>
    ({
      id: 'job-1',
      name: 'send-email',
      data: { to: 'ops@example.com' },
      attemptsMade: 3,
      opts: { attempts: 3 },
      ...overrides,
    }) as unknown as Job;

  it('configures notification queue with 3 attempts and exponential backoff', () => {
    expect(QUEUE_NAMES.NOTIFICATION_DLQ).toBe('notification-dlq');
    expect(notificationQueueOptions.defaultJobOptions).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
  });

  it('routes a job to the DLQ once retries are exhausted', async () => {
    const dlq = { add: jest.fn().mockResolvedValue({}) };

    const routed = await routeFailedNotificationToDlq(makeJob(), new Error('SMTP down'), dlq);

    expect(routed).toBe(true);
    expect(dlq.add).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({
        originalJobId: 'job-1',
        name: 'send-email',
        data: { to: 'ops@example.com' },
        failedReason: 'SMTP down',
        attemptsMade: 3,
      }),
      expect.any(Object)
    );
  });

  it('does not route a job that still has retries left', async () => {
    const dlq = { add: jest.fn() };

    const routed = await routeFailedNotificationToDlq(makeJob({ attemptsMade: 1 }), new Error('x'), dlq);

    expect(routed).toBe(false);
    expect(dlq.add).not.toHaveBeenCalled();
  });

  it('does not route when the job is undefined', async () => {
    const dlq = { add: jest.fn() };
    expect(await routeFailedNotificationToDlq(undefined, new Error('x'), dlq)).toBe(false);
    expect(dlq.add).not.toHaveBeenCalled();
  });

  it('retries a DLQ job on the notification queue and removes it from the DLQ', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const dlq = {
      getJob: jest.fn().mockResolvedValue({
        data: { name: 'send-email', data: { to: 'ops@example.com' } },
        remove,
      }),
    };
    const queue = { add: jest.fn().mockResolvedValue({ id: 'job-2' }) };

    const retried = await retryNotificationDlqJob('dlq-1', dlq, queue);

    expect(queue.add).toHaveBeenCalledWith('send-email', { to: 'ops@example.com' });
    expect(remove).toHaveBeenCalled();
    expect(retried).toEqual({ id: 'job-2' });
  });

  it('returns null when retrying a missing DLQ job', async () => {
    const dlq = { getJob: jest.fn().mockResolvedValue(undefined) };
    const queue = { add: jest.fn() };

    expect(await retryNotificationDlqJob('missing', dlq, queue)).toBeNull();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
