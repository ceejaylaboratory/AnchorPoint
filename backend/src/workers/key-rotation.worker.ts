import cron, { ScheduledTask } from 'node-cron';
import logger from '../utils/logger';
import { config } from '../config/env';
import { KeyRotationService } from '../services/key-rotation.service';

const service = new KeyRotationService();

let scheduledTask: ScheduledTask | null = null;

function startWorker(): void {
  if (config.ENABLE_KEY_ROTATION_WORKER !== 'true') {
    logger.info('Key rotation worker disabled via ENABLE_KEY_ROTATION_WORKER');
    return;
  }

  const schedule = config.KEY_ROTATION_WORKER_CRON;
  const validSchedule = cron.validate(schedule)
    ? schedule
    : (() => {
        logger.error(
          `Invalid KEY_ROTATION_WORKER_CRON "${schedule}", falling back to "0 0 1 * *"`
        );
        return '0 0 1 * *';
      })();

  scheduledTask = cron.schedule(validSchedule, () => {
    void (async () => {
      try {
        const result = await service.rotateKeys();
        logger.info('Key rotation cron tick completed', {
          backend: result.backend,
          rotated: result.rotated,
          message: result.message,
        });
      } catch (err) {
        logger.error(`Key rotation tick failed: ${(err as Error).message}`);
      }

      try {
        const jwtResult = await service.rotateJwtSigningKey();
        logger.info('JWT signing key rotation cron tick completed', {
          rotated: jwtResult.rotated,
          grace_period_seconds: jwtResult.gracePeriodSeconds,
        });
      } catch (err) {
        logger.error(`JWT signing key rotation tick failed: ${(err as Error).message}`);
      }
    })();
  });

  logger.info('Key rotation worker started');
  logger.info(`   Cron: ${validSchedule}`);
  logger.info(`   Backend: ${config.KEY_MANAGEMENT_BACKEND}`);
}

function stopWorker(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('Key rotation worker stopped');
  }
}

if (require.main === module) {
  startWorker();
  const shutdown = () => {
    stopWorker();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export { startWorker, stopWorker };
