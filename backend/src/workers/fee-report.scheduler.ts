import cron, { ScheduledTask } from 'node-cron';
import { FeeReportService } from '../services/fee-report.service';
import { pingHeartbeat } from '../lib/heartbeat';
import logger from '../utils/logger';

const feeReportService = new FeeReportService();

/**
 * Fee Report Scheduler
 * Enqueues daily and monthly fee report generation jobs into BullMQ on schedule.
 */
export class FeeReportScheduler {
  private dailyTask: ScheduledTask | null = null;
  private monthlyTask: ScheduledTask | null = null;

  /**
   * Start the scheduler
   */
  start(): void {
    if (process.env.ENABLE_FEE_REPORT_SCHEDULER === 'true') {
      this.scheduleDailyReports();
      this.scheduleMonthlyReports();
      logger.info('Fee report scheduler started');
    } else {
      logger.info('Fee report scheduler disabled via environment variable');
    }
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.dailyTask) {
      this.dailyTask.stop();
      this.dailyTask = null;
    }
    if (this.monthlyTask) {
      this.monthlyTask.stop();
      this.monthlyTask = null;
    }
    logger.info('Fee report scheduler stopped');
  }

  /**
   * Schedule daily reports to run at 00:00 every day
   */
  private scheduleDailyReports(): void {
    // Run at 00:00 every day
    this.dailyTask = cron.schedule('0 0 * * *', async () => {
      try {
        logger.info('Scheduling daily fee report job in queue');
        const job = await feeReportService.enqueueDailyReportJob();
        logger.info('Daily fee report job enqueued successfully', { jobId: job.id });
        await pingHeartbeat('fee-report-daily', process.env.HEARTBEAT_FEE_REPORT_DAILY_URL);
      } catch (error) {
        logger.error('Failed to enqueue daily fee report job', { error });
      }
    });

    logger.info('Daily fee report scheduled for 00:00 every day');
  }

  /**
   * Schedule monthly reports to run at 00:00 on the 1st of every month
   */
  private scheduleMonthlyReports(): void {
    // Run at 00:00 on the 1st of every month
    this.monthlyTask = cron.schedule('0 0 1 * *', async () => {
      try {
        logger.info('Scheduling monthly fee report job in queue');
        const now = new Date();
        const job = await feeReportService.enqueueMonthlyReportJob(
          now.getFullYear(),
          now.getMonth() - 1 // Previous month
        );
        logger.info('Monthly fee report job enqueued successfully', { jobId: job.id });
        await pingHeartbeat('fee-report-monthly', process.env.HEARTBEAT_FEE_REPORT_MONTHLY_URL);
      } catch (error) {
        logger.error('Failed to enqueue monthly fee report job', { error });
      }
    });

    logger.info('Monthly fee report scheduled for 00:00 on the 1st of every month');
  }

  /**
   * Close the underlying BullMQ queue connection. Call during graceful
   * shutdown, after `stop()` has cancelled the cron tasks.
   */
  async closeQueue(): Promise<void> {
    await feeReportService.closeQueue();
  }

  /**
   * Manually trigger a daily report job into BullMQ queue
   */
  async triggerDailyReport(date?: Date): Promise<void> {
    try {
      logger.info('Manually triggering daily fee report job in queue');
      const job = await feeReportService.enqueueDailyReportJob(date);
      logger.info('Manual daily fee report job enqueued successfully', { jobId: job.id });
    } catch (error) {
      logger.error('Failed to enqueue manual daily fee report job', { error });
      throw error;
    }
  }

  /**
   * Manually trigger a monthly report job into BullMQ queue
   */
  async triggerMonthlyReport(year?: number, month?: number): Promise<void> {
    try {
      logger.info('Manually triggering monthly fee report job in queue');
      const job = await feeReportService.enqueueMonthlyReportJob(year, month);
      logger.info('Manual monthly fee report job enqueued successfully', { jobId: job.id });
    } catch (error) {
      logger.error('Failed to enqueue manual monthly fee report job', { error });
      throw error;
    }
  }
}

// Export singleton instance
export const feeReportScheduler = new FeeReportScheduler();
