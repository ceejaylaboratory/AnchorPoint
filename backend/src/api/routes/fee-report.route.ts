import { Router, Request, Response } from 'express';
import {
  generateDailyReport,
  generateMonthlyReport,
  exportDailyReport,
  exportMonthlyReport,
  getReportHistory,
} from '../controllers/fee-report.controller';

const router = Router();

/**
 * @swagger
 * /api/reports/daily:
 *   get:
 *     summary: Generate daily fee report
 *     description: Generates a daily fee report for anchor operations
 *     tags: [Reports]
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Date for the report (YYYY-MM-DD). Defaults to today.
 *     responses:
 *       200:
 *         description: Daily fee report generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reportType:
 *                   type: string
 *                   enum: [DAILY]
 *                 startDate:
 *                   type: string
 *                   format: date-time
 *                 endDate:
 *                   type: string
 *                   format: date-time
 *                 totalFees:
 *                   type: string
 *                 totalFeesXLM:
 *                   type: string
 *                 operationCounts:
 *                   type: object
 *                 feeBreakdown:
 *                   type: object
 *       500:
 *         description: Internal server error
 */
router.get('/daily', (req: Request, res: Response) => {
  return generateDailyReport(req, res);
});

/**
 * @swagger
 * /api/reports/monthly:
 *   get:
 *     summary: Generate monthly fee report
 *     description: Generates a monthly fee report for anchor operations
 *     tags: [Reports]
 *     parameters:
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Year for the report. Defaults to current year.
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         description: Month for the report (1-12). Defaults to current month.
 *     responses:
 *       200:
 *         description: Monthly fee report generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reportType:
 *                   type: string
 *                   enum: [MONTHLY]
 *                 startDate:
 *                   type: string
 *                   format: date-time
 *                 endDate:
 *                   type: string
 *                   format: date-time
 *                 totalFees:
 *                   type: string
 *                 totalFeesXLM:
 *                   type: string
 *                 operationCounts:
 *                   type: object
 *                 feeBreakdown:
 *                   type: object
 *       500:
 *         description: Internal server error
 */
router.get('/monthly', (req: Request, res: Response) => {
  return generateMonthlyReport(req, res);
});

/**
 * @swagger
 * /api/reports/daily/export:
 *   get:
 *     summary: Export daily fee report
 *     description: Exports a daily fee report as JSON or PDF file
 *     tags: [Reports]
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Date for the report (YYYY-MM-DD). Defaults to today.
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [JSON, PDF]
 *           default: JSON
 *         description: Export format
 *     responses:
 *       200:
 *         description: Report file downloaded
 *       400:
 *         description: Invalid format parameter
 *       500:
 *         description: Internal server error
 */
router.get('/daily/export', (req: Request, res: Response) => {
  return exportDailyReport(req, res);
});

/**
 * @swagger
 * /api/reports/monthly/export:
 *   get:
 *     summary: Export monthly fee report
 *     description: Exports a monthly fee report as JSON or PDF file
 *     tags: [Reports]
 *     parameters:
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Year for the report. Defaults to current year.
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         description: Month for the report (1-12). Defaults to current month.
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [JSON, PDF]
 *           default: JSON
 *         description: Export format
 *     responses:
 *       200:
 *         description: Report file downloaded
 *       400:
 *         description: Invalid format parameter
 *       500:
 *         description: Internal server error
 */
router.get('/monthly/export', (req: Request, res: Response) => {
  return exportMonthlyReport(req, res);
});

/**
 * @swagger
 * /api/reports/history:
 *   get:
 *     summary: Get report history
 *     description: Retrieves historical fee reports
 *     tags: [Reports]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [DAILY, MONTHLY]
 *         description: Filter by report type
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of reports to return
 *     responses:
 *       200:
 *         description: Report history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       500:
 *         description: Internal server error
 */
router.get('/history', (req: Request, res: Response) => {
  return getReportHistory(req, res);
});

export default router;
