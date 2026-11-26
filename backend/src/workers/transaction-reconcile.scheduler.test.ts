import { TransactionReconcileScheduler } from './transaction-reconcile.scheduler';
import { metricsService } from '../services/metrics.service';
import { stellarService } from '../services/stellar.service';
import prisma from '../lib/prisma';
import cron from 'node-cron';
import { pingHeartbeat } from '../lib/heartbeat';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    transaction: { findMany: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('../services/stellar.service', () => ({
  stellarService: { getHorizonServer: jest.fn() },
}));

jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({ stop: jest.fn() }),
}));

jest.mock('../lib/heartbeat', () => ({
  pingHeartbeat: jest.fn().mockResolvedValue(undefined),
}));

describe('TransactionReconcileScheduler', () => {
  const call = jest.fn();

  beforeEach(() => {
    metricsService.reset();
    jest.clearAllMocks();
    (stellarService.getHorizonServer as jest.Mock).mockReturnValue({
      transactions: () => ({ transaction: () => ({ call }) }),
    });
    (prisma.transaction.findMany as jest.Mock).mockResolvedValue([
      { id: 'tx-1', stellarTxId: 'hash-1', status: 'pending_stellar' },
    ]);
  });

  it('marks the transaction completed when Horizon reports success', async () => {
    call.mockResolvedValue({ successful: true });

    const count = await new TransactionReconcileScheduler().reconcile();

    expect(count).toBe(1);
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: expect.objectContaining({ status: 'completed', sep31Status: 'completed' }),
    });
    const metrics = await metricsService.getMetrics();
    expect(metrics).toMatch(/transaction_reconciliation_total\{[^}]*outcome="completed"[^}]*\} 1/);
  });

  it('marks the transaction as error when Horizon reports failure', async () => {
    call.mockResolvedValue({ successful: false });

    const count = await new TransactionReconcileScheduler().reconcile();

    expect(count).toBe(1);
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: expect.objectContaining({ status: 'error', sep31Status: 'error' }),
    });
    const metrics = await metricsService.getMetrics();
    expect(metrics).toMatch(/transaction_reconciliation_total\{[^}]*outcome="error"[^}]*\} 1/);
  });

  it('leaves the transaction pending when Horizon has not seen it yet', async () => {
    call.mockRejectedValue({ response: { status: 404 } });

    const count = await new TransactionReconcileScheduler().reconcile();

    expect(count).toBe(0);
    expect(prisma.transaction.update).not.toHaveBeenCalled();
    const metrics = await metricsService.getMetrics();
    expect(metrics).toMatch(/transaction_reconciliation_total\{[^}]*outcome="not_found"[^}]*\} 1/);
  });

  it('only queries pending_stellar transactions older than 5 minutes', async () => {
    (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);

    await new TransactionReconcileScheduler().reconcile();

    const where = (prisma.transaction.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.status).toBe('pending_stellar');
    expect(Date.now() - where.updatedAt.lt.getTime()).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  describe('heartbeat (#1693)', () => {
    const runScheduledTask = async (): Promise<void> => {
      const scheduler = new TransactionReconcileScheduler();
      scheduler.start();
      const task = (cron.schedule as jest.Mock).mock.calls[0][1] as () => Promise<void>;
      await task();
      scheduler.stop();
    };

    afterEach(() => {
      delete process.env.HEARTBEAT_TRANSACTION_RECONCILE_URL;
    });

    it('pings the heartbeat monitor after a successful run', async () => {
      process.env.HEARTBEAT_TRANSACTION_RECONCILE_URL = 'https://hc-ping.com/reconcile';
      call.mockResolvedValue({ successful: true });

      await runScheduledTask();

      expect(pingHeartbeat).toHaveBeenCalledWith(
        'transaction-reconcile',
        'https://hc-ping.com/reconcile',
      );
    });

    it('does not ping when the run fails', async () => {
      process.env.HEARTBEAT_TRANSACTION_RECONCILE_URL = 'https://hc-ping.com/reconcile';
      (prisma.transaction.findMany as jest.Mock).mockRejectedValue(new Error('db down'));

      await runScheduledTask();

      expect(pingHeartbeat).not.toHaveBeenCalled();
    });
  });
});
