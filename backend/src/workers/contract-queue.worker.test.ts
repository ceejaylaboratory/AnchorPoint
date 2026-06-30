import { startWorker, processJob } from './contract-queue.worker';
import { Job, Queue } from 'bullmq';
import { QUEUE_NAMES } from '../config/queue';

// Mock dependencies
jest.mock('bullmq', () => {
  return {
    Worker: jest.fn().mockImplementation((name, processor, options) => {
      return {
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(true),
        disconnect: jest.fn().mockResolvedValue(true),
      };
    }),
    Queue: jest.fn().mockImplementation(() => {
      return {
        add: jest.fn().mockResolvedValue(true),
        close: jest.fn().mockResolvedValue(true),
      };
    }),
  };
});

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

jest.mock('@stellar/stellar-sdk', () => {
  return {
    Horizon: {
      Server: jest.fn().mockImplementation(() => ({
        submitTransaction: jest.fn().mockResolvedValue({
          hash: 'TEST_HASH',
          ledger: 12345,
          envelope_xdr: 'TEST_XDR',
        }),
      })),
    },
    TransactionBuilder: {
      fromXDR: jest.fn().mockReturnValue({}),
    },
    Networks: {
      TESTNET: 'Test SDF Network ; September 2015',
    },
  };
});

jest.mock('../services/soroban-error.service', () => ({
  getErrorDetails: jest.fn().mockReturnValue({ message: 'test error' }),
  isRetryable: jest.fn().mockReturnValue(true),
  formatForApi: jest.fn().mockReturnValue({ message: 'test api error' }),
}));

describe('Contract Queue Worker', () => {
  let mockJob: Partial<Job>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockJob = {
      id: '1',
      name: 'test-job',
      data: {
        type: 'CONTRACT_CALL',
        contractId: 'C123',
        functionName: 'transfer',
        parameters: { to: 'Alice', amount: 100 },
      },
      updateProgress: jest.fn().mockResolvedValue(true),
      opts: { attempts: 3 },
      attemptsMade: 1,
    };
  });

  it('should start worker successfully', () => {
    const worker = startWorker();
    expect(worker).toBeDefined();
    expect(worker.on).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(worker.on).toHaveBeenCalledWith('failed', expect.any(Function));
    expect(worker.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should process a job successfully', async () => {
    const result = await processJob(mockJob as Job);
    expect(result.success).toBe(true);
    expect(result.data.contractId).toBe('C123');
    expect(mockJob.updateProgress).toHaveBeenCalledWith(10);
    expect(mockJob.updateProgress).toHaveBeenCalledWith(100);
  });

  it('should handle TRANSACTION_SUBMIT job', async () => {
    mockJob.data = {
      type: 'TRANSACTION_SUBMIT',
      parameters: { envelopeXdr: 'TEST_XDR' },
    };
    
    const result = await processJob(mockJob as Job);
    expect(result.success).toBe(true);
    expect(result.transactionId).toBe('TEST_HASH');
  });

  it('should retry jobs on specific errors', async () => {
    // Mock the error to be retryable
    const sorobanErrorService = require('../services/soroban-error.service');
    sorobanErrorService.isRetryable.mockReturnValueOnce(true);
    
    mockJob.data = {
      type: 'TRANSACTION_SUBMIT',
      parameters: { envelopeXdr: 'INVALID_XDR' },
    };
    
    const stellarSdk = require('@stellar/stellar-sdk');
    // Force a failure
    jest.spyOn(stellarSdk.TransactionBuilder, 'fromXDR').mockImplementationOnce(() => {
      throw new Error('tx_failed');
    });

    await expect(processJob(mockJob as Job)).rejects.toThrow('tx_failed');
  });
});
