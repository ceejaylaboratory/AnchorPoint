import cron, { ScheduledTask } from 'node-cron';
import { FeeReportService } from '../services/fee-report.service';
import logger from '../utils/logger';

const feeReportService = new FeeReportService();

/**
 * Fee Report Scheduler
 * Automatically generates daily and monthly fee reports using cron jobs
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
        logger.info('Generating daily fee report');
        const reportData = await feeReportService.generateDailyReport();
        
        // Export as both JSON and PDF
        const jsonPath = await feeReportService.exportAsJSON(reportData);
        const pdfPath = await feeReportService.exportAsPDF(reportData);
        
        logger.info('Daily fee report generated successfully', {
          jsonPath,
          pdfPath,
          totalFeesXLM: reportData.totalFeesXLM,
        });
      } catch (error) {
        logger.error('Failed to generate daily fee report', { error });
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
        logger.info('Generating monthly fee report');
        const now = new Date();
        const reportData = await feeReportService.generateMonthlyReport(
          now.getFullYear(),
          now.getMonth() - 1 // Previous month
        );
        
        // Export as both JSON and PDF
        const jsonPath = await feeReportService.exportAsJSON(reportData);
        const pdfPath = await feeReportService.exportAsPDF(reportData);
        
        logger.info('Monthly fee report generated successfully', {
          jsonPath,
          pdfPath,
          totalFeesXLM: reportData.totalFeesXLM,
        });
      } catch (error) {
        logger.error('Failed to generate monthly fee report', { error });
      }
    });

    logger.info('Monthly fee report scheduled for 00:00 on the 1st of every month');
  }

  /**
   * Manually trigger a daily report (useful for testing)
   */
  async triggerDailyReport(date?: Date): Promise<void> {
    try {
      logger.info('Manually triggering daily fee report');
      const reportData = await feeReportService.generateDailyReport(date);
      
      const jsonPath = await feeReportService.exportAsJSON(reportData);
      const pdfPath = await feeReportService.exportAsPDF(reportData);
      
      logger.info('Manual daily fee report generated successfully', {
        jsonPath,
        pdfPath,
        totalFeesXLM: reportData.totalFeesXLM,
      });
    } catch (error) {
      logger.error('Failed to generate manual daily fee report', { error });
      throw error;
    }
  }

  /**
   * Manually trigger a monthly report (useful for testing)
   */
  async triggerMonthlyReport(year?: number, month?: number): Promise<void> {
    try {
      logger.info('Manually triggering monthly fee report');
      const reportData = await feeReportService.generateMonthlyReport(year, month);
      
      const jsonPath = await feeReportService.exportAsJSON(reportData);
      const pdfPath = await feeReportService.exportAsPDF(reportData);
      
      logger.info('Manual monthly fee report generated successfully', {
        jsonPath,
        pdfPath,
        totalFeesXLM: reportData.totalFeesXLM,
      });
    } catch (error) {
      logger.error('Failed to generate manual monthly fee report', { error });
      throw error;
    }
  }
}

// Export singleton instance
export const feeReportScheduler = new FeeReportScheduler();
