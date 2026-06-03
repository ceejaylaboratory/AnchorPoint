import cron from 'node-cron';
import logger from '../utils/logger';
import { config } from '../config/env';
import { KeyRotationService } from '../services/key-rotation.service';

const service = new KeyRotationService();

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

  cron.schedule(validSchedule, () => {
    service
      .rotateKeys()
      .then((result) => {
        logger.info('Key rotation cron tick completed', {
          backend: result.backend,
          rotated: result.rotated,
          message: result.message,
        });
      })
      .catch((err) =>
        logger.error(`Key rotation tick failed: ${(err as Error).message}`)
      );
  });

  logger.info('Key rotation worker started');
  logger.info(`   Cron: ${validSchedule}`);
  logger.info(`   Backend: ${config.KEY_MANAGEMENT_BACKEND}`);
}

if (require.main === module) {
  startWorker();
}

export { startWorker };
