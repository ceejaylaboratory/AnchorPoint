import cron from 'node-cron';
import logger from '../utils/logger';
import { RecurringPaymentsService } from '../services/recurring-payments.service';
import { config } from '../config/env';

const service = new RecurringPaymentsService();

function startWorker(): void {
  const schedule = config.RECURRING_PAYMENTS_WORKER_CRON;
  const validSchedule = cron.validate(schedule)
    ? schedule
    : (() => {
        logger.error(
          `Invalid RECURRING_PAYMENTS_WORKER_CRON "${schedule}", falling back to "*/1 * * * *"`
        );
        return '*/1 * * * *';
      })();

  cron.schedule(validSchedule, () => {
    service
      .processDueSchedules()
      .then((count) => {
        if (count > 0) {
          logger.info(`Processed ${count} recurring payment schedules`);
        }
      })
      .catch((err) => logger.error(`Recurring payment tick failed: ${(err as Error).message}`));
  });

  logger.info('🚀 Recurring payments worker started');
  logger.info(`   Cron: ${validSchedule}`);

  // Run once on startup
  service
    .processDueSchedules()
    .then((count) => logger.info(`Initial recurring payment processing complete: ${count} schedules`))
    .catch((err) => logger.error(`Initial recurring payment processing failed: ${(err as Error).message}`));
}

if (require.main === module) {
  startWorker();
}

export { startWorker };
