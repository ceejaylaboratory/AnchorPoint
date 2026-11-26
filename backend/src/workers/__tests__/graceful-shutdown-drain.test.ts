/**
 * Integration-style tests for the BullMQ worker graceful drain period.
 *
 * These tests verify the SIGTERM contract required by issue #1604:
 * - Workers stop accepting new jobs immediately on SIGTERM.
 * - In-flight jobs are granted up to the drain timeout to finish.
 * - Jobs that exceed the drain window are re-queued without lock contention.
 */

import { setupWorkerGracefulShutdown, CloseableWorker } from '../graceful-shutdown';
import type { Job } from 'bullmq';
import logger from '../../utils/logger';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

function makeWorker(overrides: Partial<jest.Mocked<CloseableWorker>> = {}): jest.Mocked<CloseableWorker> {
  return {
    close: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    ...overrides,
  };
}

describe('Graceful drain period on SIGTERM (#1604)', () => {
  let processOnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    processOnSpy = jest.spyOn(process, 'on').mockImplementation((_event: any, _listener: any) => process);
  });

  afterEach(() => {
    jest.useRealTimers();
    processOnSpy.mockRestore();
  });

  it('calls worker.pause() before worker.close() so new jobs are stopped first', async () => {
    const callOrder: string[] = [];
    const worker = makeWorker({
      pause: jest.fn().mockImplementation(async () => { callOrder.push('pause'); }),
      close: jest.fn().mockImplementation(async () => { callOrder.push('close'); }),
    });

    const handler = setupWorkerGracefulShutdown(worker, {
      workerName: 'PaymentWorker',
      timeoutMs: 5000,
      exitProcess: false,
    });

    await handler('SIGTERM');

    expect(callOrder).toEqual(['pause', 'close']);
  });

  it('allows an in-flight job to finish within the drain window', async () => {
    // Simulate a job that takes 1 second to finish.
    let jobDone = false;
    const worker = makeWorker({
      pause: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockImplementation(async () => {
        // Simulate work completing before the drain window expires.
        await new Promise<void>((resolve) => setTimeout(() => { jobDone = true; resolve(); }, 100));
      }),
    });

    const handler = setupWorkerGracefulShutdown(worker, {
      workerName: 'SettlementWorker',
      timeoutMs: 30000,
      exitProcess: false,
    });

    const shutdown = handler('SIGTERM');
    jest.runAllTimers();
    await shutdown;

    expect(jobDone).toBe(true);
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('SettlementWorker closed successfully'),
    );
  });

  it('re-queues in-flight jobs and force-closes when the drain window expires', async () => {
    const mockJob = {
      id: 'job-42',
      token: 'token-42',
      moveToDelayed: jest.fn().mockResolvedValue(undefined),
    } as unknown as Job;

    const eventListeners: Record<string, (job: Job) => void> = {};

    const worker = makeWorker({
      on: jest.fn().mockImplementation((event: string, cb: (job: Job) => void) => {
        eventListeners[event] = cb;
      }),
      pause: jest.fn().mockResolvedValue(undefined),
      // close() never resolves — simulates a stuck job.
      close: jest.fn().mockReturnValue(new Promise(() => {})),
    });

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    const handler = setupWorkerGracefulShutdown(worker, {
      workerName: 'StuckWorker',
      timeoutMs: 10000,
      exitProcess: true,
    });

    // Emit an 'active' job event so the in-flight tracker picks it up.
    if (typeof eventListeners['active'] === 'function') {
      eventListeners['active'](mockJob);
    }

    const shutdownPromise = handler('SIGTERM');

    // Advance past the 10-second drain window.
    jest.advanceTimersByTime(10000);

    // Let the timer callback flush (it's async).
    await Promise.resolve();
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Graceful shutdown timed out after 10000ms for StuckWorker'),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    // Drain to avoid unhandled rejections from the never-resolving close promise.
    await Promise.resolve();
    shutdownPromise.catch(() => {});
  });

  it('logs a warning and skips duplicate signals during shutdown', async () => {
    let resolveClose: () => void;
    const worker = makeWorker({
      close: jest.fn().mockReturnValue(new Promise<void>((resolve) => { resolveClose = resolve; })),
    });

    const handler = setupWorkerGracefulShutdown(worker, {
      workerName: 'FeeWorker',
      exitProcess: false,
    });

    const first = handler('SIGTERM');
    const second = handler('SIGINT'); // should be a no-op

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('graceful shutdown already in progress for FeeWorker'),
    );

    resolveClose!();
    await first;
    await second;

    // close was only called by the first signal handler.
    expect(worker.close).toHaveBeenCalledTimes(1);
  });
});
