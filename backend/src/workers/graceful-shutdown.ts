import logger from '../utils/logger';

export interface GracefulShutdownOptions {
  workerName?: string;
  timeoutMs?: number; // default 15000 (15-second grace window)
  onShutdown?: () => Promise<void> | void;
  exitProcess?: boolean; // default true (set to false in unit tests)
}

export interface CloseableWorker {
  close: () => Promise<unknown>;
  disconnect?: () => Promise<unknown>;
}

/**
 * Registers SIGINT and SIGTERM listeners to gracefully shut down a worker,
 * allowing active BullMQ jobs to finish within a 15-second grace window.
 */
export function setupWorkerGracefulShutdown(
  worker: CloseableWorker,
  options: GracefulShutdownOptions = {}
): (signal: string) => Promise<void> {
  const {
    workerName = 'Worker',
    timeoutMs = 15000,
    onShutdown,
    exitProcess = true,
  } = options;

  let isShuttingDown = false;

  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn(`${signal} received again, graceful shutdown already in progress for ${workerName}`);
      return;
    }
    isShuttingDown = true;

    logger.info(`${signal} received: initiating graceful shutdown for ${workerName} (grace window: ${timeoutMs / 1000}s)`);

    // Setup 15-second grace window timer to prevent hanging
    const forceExitTimer = setTimeout(() => {
      logger.error(`Graceful shutdown timed out after ${timeoutMs}ms for ${workerName}. Forcing exit.`);
      if (exitProcess) {
        process.exit(1);
      }
    }, timeoutMs);

    if (forceExitTimer.unref) {
      forceExitTimer.unref();
    }

    try {
      // 1. Close BullMQ worker - waits for active jobs to finish
      logger.info(`Waiting for active jobs to finish and closing ${workerName}...`);
      await worker.close();
      logger.info(`${workerName} closed successfully`);

      // 2. Disconnect if supported
      if (typeof worker.disconnect === 'function') {
        try {
          await worker.disconnect();
          logger.info(`${workerName} disconnected from Redis`);
        } catch (disconnectErr) {
          logger.warn(`Warning disconnecting ${workerName}:`, disconnectErr);
        }
      }

      // 3. Custom cleanup hook if provided
      if (onShutdown) {
        logger.info(`Running additional cleanup for ${workerName}...`);
        await onShutdown();
        logger.info(`Additional cleanup completed for ${workerName}`);
      }

      clearTimeout(forceExitTimer);
      logger.info(`Graceful shutdown completed successfully for ${workerName} (${signal})`);
      if (exitProcess) {
        process.exit(0);
      }
    } catch (error) {
      clearTimeout(forceExitTimer);
      logger.error(`Error during graceful shutdown for ${workerName}:`, error);
      if (exitProcess) {
        process.exit(1);
      }
    }
  };

  process.on('SIGTERM', () => {
    void handleShutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    void handleShutdown('SIGINT');
  });

  return handleShutdown;
}
