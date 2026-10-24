/**
 * FeeReportService unit tests – #1526
 *
 * Verifies that the service handles an empty transaction result set gracefully:
 * - generateReport() returns a zero-value report (no crash / TypeError)
 * - exportAsPDF() renders "No transactions in this period" text
 */

import { FeeReportService } from './fee-report.service';

// ---------------------------------------------------------------------------
// Mock heavy dependencies so the tests run without infrastructure
// ---------------------------------------------------------------------------

// jest.mock factories are hoisted, so we cannot reference outer variables.
// We store the mock in module scope and retrieve it via require() in tests.
jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    transaction: {
      findMany: jest.fn(),
    },
    feeReport: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

// Stub pdfkit so we don't need a real PDF renderer in unit tests.
jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => {
    const docStub = {
      fontSize: jest.fn().mockReturnThis(),
      font: jest.fn().mockReturnThis(),
      text: jest.fn().mockReturnThis(),
      moveDown: jest.fn().mockReturnThis(),
      pipe: jest.fn().mockReturnValue({
        on: jest.fn(
          (event: string, cb: (...args: unknown[]) => void): { on: jest.Mock } => {
            if (event === 'finish') {
              setImmediate(cb);
            }
            return { on: jest.fn() };
          },
        ),
      }),
      end: jest.fn(),
    };
    return docStub;
  });
});

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  createWriteStream: jest.fn().mockReturnValue({
    on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'finish') setImmediate(cb);
      return { on: jest.fn() };
    }),
  }),
}));

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-123' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../config/queue', () => ({
  QUEUE_NAMES: { FEE_REPORTS: 'fee-reports' },
  defaultQueueOptions: {},
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Retrieve the mock prisma instance via require() after hoisting completes.
const getPrismaMock = () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (require('../lib/prisma') as { default: typeof import('../lib/prisma').default }).default as {
    transaction: { findMany: jest.Mock };
    feeReport: { create: jest.Mock; findMany: jest.Mock };
  };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeeReportService (#1526 – empty result set guard)', () => {
  let service: FeeReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FeeReportService();
  });

  describe('generateReport with empty dataset', () => {
    it('returns a valid zero-value report when there are no transactions', async () => {
      getPrismaMock().transaction.findMany.mockResolvedValue([]);

      const start = new Date('2026-01-01');
      const end = new Date('2026-01-01T23:59:59.999Z');
      const report = await service.generateReport('DAILY', start, end);

      expect(report.reportType).toBe('DAILY');
      expect(report.totalFees).toBeDefined();
      expect(report.totalFeesXLM).toBeDefined();
      // Zero amounts – no TypeError should be thrown.
      expect(() => parseFloat(report.totalFees)).not.toThrow();
      expect(() => parseFloat(report.totalFeesXLM)).not.toThrow();
      expect(parseFloat(report.totalFees)).toBe(0);
      expect(parseFloat(report.totalFeesXLM)).toBe(0);
    });

    it('returns an empty feeBreakdown when there are no transactions', async () => {
      getPrismaMock().transaction.findMany.mockResolvedValue([]);

      const report = await service.generateReport(
        'DAILY',
        new Date('2026-01-01'),
        new Date('2026-01-01T23:59:59.999Z'),
      );

      expect(report.feeBreakdown).toEqual({});
    });

    it('all operationCounts default to 0 for an empty result set', async () => {
      getPrismaMock().transaction.findMany.mockResolvedValue([]);

      const report = await service.generateReport(
        'MONTHLY',
        new Date('2026-01-01'),
        new Date('2026-01-31T23:59:59.999Z'),
      );

      expect(report.operationCounts.DEPOSIT).toBe(0);
      expect(report.operationCounts.WITHDRAW).toBe(0);
      expect(report.operationCounts.SWAP).toBe(0);
      expect(report.operationCounts.SEP31).toBe(0);
    });

    it('saves the empty report to the database without throwing', async () => {
      getPrismaMock().transaction.findMany.mockResolvedValue([]);

      await expect(
        service.generateReport(
          'DAILY',
          new Date('2026-01-01'),
          new Date('2026-01-01T23:59:59.999Z'),
        ),
      ).resolves.not.toThrow();

      expect(getPrismaMock().feeReport.create).toHaveBeenCalledTimes(1);
    });

    it('does not throw when tx.feeAmount or tx.feeAssetCode is null', async () => {
      getPrismaMock().transaction.findMany.mockResolvedValue([
        { type: 'DEPOSIT', amount: '100', feeAmount: null, feeAssetCode: null },
      ]);

      await expect(
        service.generateReport(
          'DAILY',
          new Date('2026-01-01'),
          new Date('2026-01-01T23:59:59.999Z'),
        ),
      ).resolves.not.toThrow();
    });
  });

  describe('exportAsPDF with empty feeBreakdown', () => {
    it('renders "No transactions in this period" when feeBreakdown is empty', async () => {
      // Collect text written to the PDF document mock.
      const capturedText: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const PDFDocument = require('pdfkit') as jest.Mock;
      PDFDocument.mockImplementationOnce(() => {
        const stub: Record<string, unknown> = {};

        const pipeReturnValue = {
          on: (event: string, cb: (...args: unknown[]) => void): { on: jest.Mock } => {
            if (event === 'finish') setImmediate(cb);
            return { on: jest.fn() };
          },
        };

        stub['fontSize'] = jest.fn().mockReturnValue(stub);
        stub['font'] = jest.fn().mockReturnValue(stub);
        stub['text'] = jest.fn().mockImplementation((t: string) => {
          capturedText.push(t);
          return stub;
        });
        stub['moveDown'] = jest.fn().mockReturnValue(stub);
        stub['pipe'] = jest.fn().mockReturnValue(pipeReturnValue);
        stub['end'] = jest.fn();
        return stub;
      });

      const emptyReport = {
        reportType: 'DAILY' as const,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-01T23:59:59.999Z'),
        totalFees: '0.0000000',
        totalFeesXLM: '0.0000000',
        operationCounts: { DEPOSIT: 0, WITHDRAW: 0, SWAP: 0, SEP31: 0 },
        feeBreakdown: {},
      };

      await service.exportAsPDF(emptyReport);

      expect(capturedText.some((t) => t.includes('No transactions in this period'))).toBe(true);
    });
  });
});
