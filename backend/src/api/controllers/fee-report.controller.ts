import { Request, Response } from 'express';
import { FeeReportService } from '../../services/fee-report.service';
import logger from '../../utils/logger';

const feeReportService = new FeeReportService();

/**
 * GET /api/reports/daily
 * Generate a daily fee report
 */
export async function generateDailyReport(req: Request, res: Response): Promise<void> {
  try {
    const dateParam = req.query.date as string;
    const date = dateParam ? new Date(dateParam) : undefined;
    
    const reportData = await feeReportService.generateDailyReport(date);
    res.json(reportData);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate daily report';
    logger.error('Daily report generation failed', { error: message });
    res.status(500).json({ error: message });
  }
}

/**
 * GET /api/reports/monthly
 * Generate a monthly fee report
 */
export async function generateMonthlyReport(req: Request, res: Response): Promise<void> {
  try {
    const yearParam = req.query.year as string;
    const monthParam = req.query.month as string;
    
    const year = yearParam ? parseInt(yearParam, 10) : undefined;
    const month = monthParam ? parseInt(monthParam, 10) - 1 : undefined; // Convert to 0-based month
    
    const reportData = await feeReportService.generateMonthlyReport(year, month);
    res.json(reportData);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate monthly report';
    logger.error('Monthly report generation failed', { error: message });
    res.status(500).json({ error: message });
  }
}

/**
 * GET /api/reports/daily/export
 * Export daily report as JSON or PDF
 */
export async function exportDailyReport(req: Request, res: Response): Promise<void> {
  try {
    const format = (req.query.format as string)?.toUpperCase() || 'JSON';
    const dateParam = req.query.date as string;
    const date = dateParam ? new Date(dateParam) : undefined;
    
    if (format !== 'JSON' && format !== 'PDF') {
      res.status(400).json({ error: 'Invalid format. Use JSON or PDF' });
      return;
    }

    const reportData = await feeReportService.generateDailyReport(date);
    let filePath: string;
    let filename: string;

    if (format === 'JSON') {
      filePath = await feeReportService.exportAsJSON(reportData);
      filename = `fee-report-daily-${reportData.startDate.toISOString().split('T')[0]}.json`;
    } else {
      filePath = await feeReportService.exportAsPDF(reportData);
      filename = `fee-report-daily-${reportData.startDate.toISOString().split('T')[0]}.pdf`;
    }

    res.download(filePath, filename);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to export daily report';
    logger.error('Daily report export failed', { error: message });
    res.status(500).json({ error: message });
  }
}

/**
 * GET /api/reports/monthly/export
 * Export monthly report as JSON or PDF
 */
export async function exportMonthlyReport(req: Request, res: Response): Promise<void> {
  try {
    const format = (req.query.format as string)?.toUpperCase() || 'JSON';
    const yearParam = req.query.year as string;
    const monthParam = req.query.month as string;
    
    const year = yearParam ? parseInt(yearParam, 10) : undefined;
    const month = monthParam ? parseInt(monthParam, 10) - 1 : undefined;
    
    if (format !== 'JSON' && format !== 'PDF') {
      res.status(400).json({ error: 'Invalid format. Use JSON or PDF' });
      return;
    }

    const reportData = await feeReportService.generateMonthlyReport(year, month);
    let filePath: string;
    let filename: string;

    if (format === 'JSON') {
      filePath = await feeReportService.exportAsJSON(reportData);
      filename = `fee-report-monthly-${reportData.startDate.toISOString().split('T')[0]}.json`;
    } else {
      filePath = await feeReportService.exportAsPDF(reportData);
      filename = `fee-report-monthly-${reportData.startDate.toISOString().split('T')[0]}.pdf`;
    }

    res.download(filePath, filename);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to export monthly report';
    logger.error('Monthly report export failed', { error: message });
    res.status(500).json({ error: message });
  }
}

/**
 * GET /api/reports/history
 * Get historical fee reports
 */
export async function getReportHistory(req: Request, res: Response): Promise<void> {
  try {
    const reportType = req.query.type as 'DAILY' | 'MONTHLY' | undefined;
    const limitParam = req.query.limit as string;
    const limit = limitParam ? parseInt(limitParam, 10) : 10;

    const reports = await feeReportService.getReports(reportType, limit);
    res.json(reports);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch report history';
    logger.error('Report history fetch failed', { error: message });
    res.status(500).json({ error: message });
  }
}
