import { Job } from 'bullmq';
import { StellarTxWorker, StellarTxJobData } from './stellar-tx.worker';

describe('StellarTxWorker', () => {
  let worker: StellarTxWorker;

  beforeEach(() => {
    worker = new StellarTxWorker();
  });

  afterEach(async () => {
    await worker.close();
  });

  it('should process stellar tx job successfully', async () => {
    const mockJob = {
      id: 'job-tx-1',
      data: {
        transactionXdr: 'AAAA...',
      }
    } as unknown as Job<StellarTxJobData>;

    const result = await worker.processJob(mockJob);
    expect(result).toHaveProperty('hash');
    expect(result.hash).toContain('mock_tx_hash_');
  });
});
