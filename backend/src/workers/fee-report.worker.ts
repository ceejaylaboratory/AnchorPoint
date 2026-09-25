import { Worker, Job } from 'bullmq';
import { FeeReportService, FeeReportJobData } from '../services/fee-report.service';
import { defaultWorkerOptions, QUEUE_NAMES } from '../config/queue';
import logger from '../utils/logger';
import { setupWorkerGracefulShutdown } from './graceful-shutdown';

const feeReportService = new FeeReportService();

/**
 * Worker handler for processing fee report generation jobs asynchronously.
 */
export async function processFeeReportJob(job: Job<FeeReportJobData>) {
  logger.info(`Processing fee report job ${job.id} of type ${job.name}`, { data: job.data });

  const { reportType, date, year, month } = job.data;

  let reportData;
  if (reportType === 'DAILY' || job.name === 'generate-daily') {
    const targetDate = date ? new Date(date) : undefined;
    reportData = await feeReportService.generateDailyReport(targetDate);
  } else if (reportType === 'MONTHLY' || job.name === 'generate-monthly') {
    reportData = await feeReportService.generateMonthlyReport(year, month);
  } else {
    throw new Error(`Unknown job type or name: ${job.name} / ${reportType}`);
  }

  // Export report files (JSON & PDF)
  const jsonPath = await feeReportService.exportAsJSON(reportData);
  const pdfPath = await feeReportService.exportAsPDF(reportData);

  logger.info(`Successfully processed fee report job ${job.id}`, {
    reportType: reportData.reportType,
    totalFeesXLM: reportData.totalFeesXLM,
    jsonPath,
    pdfPath,
  });

  return {
    reportType: reportData.reportType,
    startDate: reportData.startDate,
    endDate: reportData.endDate,
    totalFeesXLM: reportData.totalFeesXLM,
    jsonPath,
    pdfPath,
  };
}

/**
 * Create and export BullMQ Worker instance for fee report jobs
 */
export const feeReportWorker = new Worker<FeeReportJobData>(
  QUEUE_NAMES.FEE_REPORTS,
  processFeeReportJob,
  defaultWorkerOptions
);

feeReportWorker.on('completed', (job, result) => {
  logger.info(`Fee report job ${job.id} completed successfully`, { result });
});

feeReportWorker.on('failed', (job, err) => {
  logger.error(`Fee report job ${job?.id} failed with error: ${err.message}`, { error: err });
});

feeReportWorker.on('error', (err) => {
  logger.error('Fee report worker encountered an error', { error: err });
});

// If executed directly as worker process
if (require.main === module) {
  logger.info('Fee report worker process started');
  setupWorkerGracefulShutdown(feeReportWorker, {
    workerName: 'Fee report worker',
    timeoutMs: 15000,
  });
}
