import { PrismaClient } from '@prisma/client';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export interface FeeReportData {
  reportType: 'DAILY' | 'MONTHLY';
  startDate: Date;
  endDate: Date;
  totalFees: string;
  totalFeesXLM: string;
  operationCounts: OperationCounts;
  feeBreakdown: Record<string, FeeSummary>;
}

export interface FeeSummary {
  operationType: string;
  totalAmount: string;
  totalFees: string;
  transactionCount: number;
  averageFee: string;
}

export interface OperationCounts {
  DEPOSIT: number;
  WITHDRAW: number;
  SWAP: number;
  SEP31: number;
}

/**
 * Fee Report Service
 * Handles generation of daily and monthly fee reports for anchor operations
 */
export class FeeReportService {
  private reportsDir: string;

  constructor() {
    this.reportsDir = path.join(process.cwd(), 'reports');
    this.ensureReportsDirectory();
  }

  /**
   * Ensure the reports directory exists
   */
  private ensureReportsDirectory(): void {
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
      logger.info(`Created reports directory: ${this.reportsDir}`);
    }
  }

  /**
   * Generate a daily fee report
   */
  async generateDailyReport(date?: Date): Promise<FeeReportData> {
    const reportDate = date || new Date();
    const startDate = new Date(reportDate);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(reportDate);
    endDate.setHours(23, 59, 59, 999);

    return this.generateReport('DAILY', startDate, endDate);
  }

  /**
   * Generate a monthly fee report
   */
  async generateMonthlyReport(year?: number, month?: number): Promise<FeeReportData> {
    const now = new Date();
    const reportYear = year || now.getFullYear();
    const reportMonth = month !== undefined ? month : now.getMonth();

    const startDate = new Date(reportYear, reportMonth, 1);
    const endDate = new Date(reportYear, reportMonth + 1, 0, 23, 59, 59, 999);

    return this.generateReport('MONTHLY', startDate, endDate);
  }

  /**
   * Generate a fee report for a given date range
   */
  async generateReport(
    reportType: 'DAILY' | 'MONTHLY',
    startDate: Date,
    endDate: Date
  ): Promise<FeeReportData> {
    logger.info(`Generating ${reportType} fee report`, { startDate, endDate });

    // Fetch completed transactions within the date range
    const transactions = await prisma.transaction.findMany({
      where: {
        status: 'COMPLETED',
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        type: true,
        amount: true,
        feeAmount: true,
        feeAssetCode: true,
      },
    });

    // Calculate fee summaries by operation type
    const operationCounts: OperationCounts = {
      DEPOSIT: 0,
      WITHDRAW: 0,
      SWAP: 0,
      SEP31: 0,
    };

    const feeBreakdown: Record<string, FeeSummary> = {};
    let totalFees = '0';
    let totalFeesXLM = '0';

    transactions.forEach((tx) => {
      const opType = tx.type;
      if (Object.hasOwn(operationCounts, opType)) {
        operationCounts[opType as keyof OperationCounts] += 1;
      }

      const feeAmount = tx.feeAmount || '0';
      const feeAsset = tx.feeAssetCode || 'XLM';

      // Initialize breakdown if not exists
      if (!feeBreakdown[opType]) {
        feeBreakdown[opType] = {
          operationType: opType,
          totalAmount: '0',
          totalFees: '0',
          transactionCount: 0,
          averageFee: '0',
        };
      }

      // Update breakdown
      feeBreakdown[opType].transactionCount += 1;
      feeBreakdown[opType].totalFees = this.addStrings(feeBreakdown[opType].totalFees, feeAmount);
      
      // Convert to XLM for total (simplified conversion - in production, use actual exchange rates)
      const feeInXLM = feeAsset === 'XLM' ? feeAmount : this.estimateXLMValue(feeAmount, feeAsset);
      totalFeesXLM = this.addStrings(totalFeesXLM, feeInXLM);

      // Track total fees in original asset (using first encountered asset as base)
      if (totalFees === '0' && feeAmount !== '0') {
        totalFees = feeAmount;
      }
    });

    // Calculate average fees
    Object.keys(feeBreakdown).forEach((opType) => {
      const summary = feeBreakdown[opType];
      if (summary.transactionCount > 0) {
        summary.averageFee = this.divideStrings(summary.totalFees, summary.transactionCount.toString());
      }
    });

    const reportData: FeeReportData = {
      reportType,
      startDate,
      endDate,
      totalFees,
      totalFeesXLM,
      operationCounts,
      feeBreakdown,
    };

    // Save report to database
    await this.saveReportToDatabase(reportData);

    logger.info(`Generated ${reportType} report`, {
      totalFeesXLM,
      transactionCount: transactions.length,
    });

    return reportData;
  }

  /**
   * Export report as JSON
   */
  async exportAsJSON(reportData: FeeReportData): Promise<string> {
    const filename = `fee-report-${reportData.reportType.toLowerCase()}-${reportData.startDate.toISOString().split('T')[0]}.json`;
    const filePath = path.join(this.reportsDir, filename);

    const jsonContent = JSON.stringify(reportData, null, 2);
    fs.writeFileSync(filePath, jsonContent, 'utf-8');

    logger.info(`Exported report as JSON`, { filePath });
    return filePath;
  }

  /**
   * Export report as PDF
   */
  async exportAsPDF(reportData: FeeReportData): Promise<string> {
    const filename = `fee-report-${reportData.reportType.toLowerCase()}-${reportData.startDate.toISOString().split('T')[0]}.pdf`;
    const filePath = path.join(this.reportsDir, filename);

    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Title
    doc.fontSize(24).font('Helvetica-Bold').text(`Anchor Fee Report - ${reportData.reportType}`, { align: 'center' });
    doc.moveDown();

    // Date range
    doc.fontSize(12).font('Helvetica').text(`Report Period:`, { continued: true });
    doc.font('Helvetica-Bold').text(` ${reportData.startDate.toISOString().split('T')[0]} to ${reportData.endDate.toISOString().split('T')[0]}`);
    doc.moveDown();
    doc.text(`Generated: ${new Date().toISOString()}`);
    doc.moveDown();

    // Summary
    doc.fontSize(16).font('Helvetica-Bold').text('Summary');
    doc.moveDown();
    doc.fontSize(12).font('Helvetica');
    doc.text(`Total Fees Collected: ${reportData.totalFeesXLM} XLM`);
    doc.text(`Total Transactions: ${Object.values(reportData.operationCounts).reduce((a, b) => a + b, 0)}`);
    doc.moveDown();

    // Operation counts
    doc.fontSize(16).font('Helvetica-Bold').text('Operation Counts');
    doc.moveDown();
    doc.fontSize(12).font('Helvetica');
    Object.entries(reportData.operationCounts).forEach(([opType, count]) => {
      doc.text(`${opType}: ${count}`);
    });
    doc.moveDown();

    // Fee breakdown
    doc.fontSize(16).font('Helvetica-Bold').text('Fee Breakdown by Operation Type');
    doc.moveDown();
    doc.fontSize(12).font('Helvetica');

    Object.values(reportData.feeBreakdown).forEach((summary: FeeSummary) => {
      doc.text(`\n${summary.operationType}`);
      doc.text(`  Transactions: ${summary.transactionCount}`);
      doc.text(`  Total Fees: ${summary.totalFees}`);
      doc.text(`  Average Fee: ${summary.averageFee}`);
    });

    doc.end();

    return new Promise((resolve, reject) => {
      stream.on('finish', () => {
        logger.info(`Exported report as PDF`, { filePath });
        resolve(filePath);
      });
      stream.on('error', reject);
    });
  }

  /**
   * Save report to database
   */
  private async saveReportToDatabase(reportData: FeeReportData): Promise<void> {
    try {
      await prisma.feeReport.create({
        data: {
          reportType: reportData.reportType,
          startDate: reportData.startDate,
          endDate: reportData.endDate,
          totalFees: reportData.totalFees,
          totalFeesXLM: reportData.totalFeesXLM,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          operationCounts: structuredClone(reportData.operationCounts) as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          feeBreakdown: structuredClone(reportData.feeBreakdown) as any,
        },
      });
    } catch (error) {
      logger.error('Failed to save report to database', { error });
      throw error;
    }
  }

  /**
   * Get historical reports
   */
  async getReports(reportType?: 'DAILY' | 'MONTHLY', limit = 10): Promise<unknown[]> {
    const where = reportType ? { reportType } : {};
    return prisma.feeReport.findMany({
      where,
      orderBy: { generatedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Helper: Add two string numbers
   */
  private addStrings(a: string, b: string): string {
    const numA = parseFloat(a) || 0;
    const numB = parseFloat(b) || 0;
    return (numA + numB).toString();
  }

  /**
   * Helper: Divide string number by integer
   */
  private divideStrings(a: string, b: string): string {
    const numA = parseFloat(a) || 0;
    const numB = parseFloat(b) || 1;
    return (numA / numB).toFixed(7);
  }

  /**
   * Helper: Estimate XLM value (simplified - use real exchange rates in production)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private estimateXLMValue(amount: string, assetCode: string): string {
    // This is a placeholder. In production, integrate with a price oracle
    // For now, assume 1:1 for non-XLM assets (this should be replaced with real rates)
    return amount;
  }
}
