import { MultisigReconcileScheduler } from './multisig-reconcile.scheduler';
import multisigService from '../services/multisig.service';

jest.mock('../services/multisig.service', () => ({
  __esModule: true,
  default: { reconcilePendingTransactions: jest.fn() },
}));

describe('MultisigReconcileScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to the multisig service and returns the number of updated transactions', async () => {
    (multisigService.reconcilePendingTransactions as jest.Mock).mockResolvedValue({
      checked: 5,
      updated: 2,
      failed: 0,
    });

    const updated = await new MultisigReconcileScheduler().reconcile();

    expect(multisigService.reconcilePendingTransactions).toHaveBeenCalledTimes(1);
    expect(updated).toBe(2);
  });

  it('start and stop manage the cron task without throwing', () => {
    const scheduler = new MultisigReconcileScheduler();
    scheduler.start();
    expect(() => scheduler.stop()).not.toThrow();
  });
});
