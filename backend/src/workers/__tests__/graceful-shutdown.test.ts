import { setupWorkerGracefulShutdown, CloseableWorker } from '../graceful-shutdown';
import logger from '../../utils/logger';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe('Worker Graceful Shutdown Handler', () => {
  let mockWorker: jest.Mocked<CloseableWorker>;
  let processOnSpy: jest.SpyInstance;
  let signalHandlers: Record<string, (signal: string) => Promise<void>> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    signalHandlers = {};
    processOnSpy = jest.spyOn(process, 'on').mockImplementation((event: string | symbol, listener: any) => {
      signalHandlers[String(event)] = listener;
      return process;
    });

    mockWorker = {
      close: jest.fn().mockResolvedValue(true),
      disconnect: jest.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    processOnSpy.mockRestore();
  });

  it('registers SIGTERM and SIGINT listeners', () => {
    setupWorkerGracefulShutdown(mockWorker, {
      workerName: 'TestWorker',
      exitProcess: false,
    });

    expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });

  it('closes worker when SIGTERM is received and waits for active jobs to finish', async () => {
    const onShutdown = jest.fn().mockResolvedValue(undefined);

    const handler = setupWorkerGracefulShutdown(mockWorker, {
      workerName: 'ContractWorker',
      timeoutMs: 15000,
      onShutdown,
      exitProcess: false,
    });

    await handler('SIGTERM');

    expect(mockWorker.close).toHaveBeenCalledTimes(1);
    expect(mockWorker.disconnect).toHaveBeenCalledTimes(1);
    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Graceful shutdown completed successfully for ContractWorker (SIGTERM)')
    );
  });

  it('closes worker when SIGINT is received', async () => {
    const handler = setupWorkerGracefulShutdown(mockWorker, {
      workerName: 'FeeReportWorker',
      timeoutMs: 15000,
      exitProcess: false,
    });

    await handler('SIGINT');

    expect(mockWorker.close).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('SIGINT received: initiating graceful shutdown for FeeReportWorker (grace window: 15s)')
    );
  });

  it('prevents multiple concurrent shutdown executions if multiple signals arrive', async () => {
    let resolveClose: (val?: any) => void = () => {};
    mockWorker.close.mockImplementation(
      () => new Promise((resolve) => {
        resolveClose = resolve;
      })
    );

    const handler = setupWorkerGracefulShutdown(mockWorker, {
      workerName: 'TestWorker',
      exitProcess: false,
    });

    // Fire first signal
    const firstShutdown = handler('SIGTERM');

    // Fire second signal while first is still waiting
    const secondShutdown = handler('SIGINT');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('SIGINT received again, graceful shutdown already in progress')
    );

    resolveClose(true);
    await firstShutdown;
    await secondShutdown;

    expect(mockWorker.close).toHaveBeenCalledTimes(1);
  });

  it('times out after 15 seconds if worker close hangs', async () => {
    // Worker close never resolves (simulating stuck active job)
    mockWorker.close.mockImplementation(() => new Promise(() => {}));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    const handler = setupWorkerGracefulShutdown(mockWorker, {
      workerName: 'HangingWorker',
      timeoutMs: 15000,
      exitProcess: true,
    });

    // Start shutdown
    const shutdownPromise = handler('SIGTERM');

    // Advance timers past the 15-second grace window
    jest.advanceTimersByTime(15000);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Graceful shutdown timed out after 15000ms for HangingWorker. Forcing exit.')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it('handles error during worker close without unhandled rejection', async () => {
    mockWorker.close.mockRejectedValue(new Error('Redis connection lost'));

    const handler = setupWorkerGracefulShutdown(mockWorker, {
      workerName: 'FailingWorker',
      timeoutMs: 15000,
      exitProcess: false,
    });

    await handler('SIGTERM');

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error during graceful shutdown for FailingWorker:'),
      expect.any(Error)
    );
  });
});
