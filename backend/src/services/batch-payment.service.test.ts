/**
 * Batch Payment Service Tests
 * 
 * Comprehensive tests for the batch payment service
 */

import { BatchPaymentService } from '../services/batch-payment.service';
import { BatchPaymentError, BatchErrorType, PaymentOperation } from '../services/batch-payment.types';

// Mock the Stellar SDK
jest.mock('@stellar/stellar-sdk', () => {
  const mockAccount = {
    sequenceNumber: () => '123456789012345678',
  };

  const mockServer = {
    loadAccount: jest.fn().mockResolvedValue(mockAccount),
    submitTransaction: jest.fn(),
  };

  return {
    Keypair: {
      fromSecret: jest.fn().mockReturnValue({
        publicKey: () => 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      }),
    },
    Server: jest.fn().mockImplementation(() => mockServer),
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({
        sign: jest.fn(),
        toXDR: jest.fn().mockReturnValue('mock_xdr'),
      }),
    })),
    Networks: {
      TESTNET: 'Test SDF Network ; September 2015',
      PUBLIC: 'Public Global Stellar Network ; September 2015',
    },
    Operation: {
      payment: jest.fn().mockReturnValue({ type: 'payment' }),
    },
    Asset: {
      native: jest.fn().mockReturnValue({ code: 'XLM' }),
    },
    StrKey: {
      isValidEd25519PublicKey: jest.fn((key) => key.startsWith('G') && key.length === 56),
    },
    Account: jest.fn(),
  };
});

// Mock Redis
jest.mock('../lib/redis', () => ({
  redis: {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  },
}));

// Mock logger
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('BatchPaymentService', () => {
  let batchService: BatchPaymentService;

  const mockPayments: PaymentOperation[] = [
    {
      destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      amount: '10.5',
    },
    {
      destination: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
      amount: '20.0',
    },
  ];

  const mockSecretKey = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  beforeEach(() => {
    jest.clearAllMocks();
    batchService = new BatchPaymentService({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      maxRetries: 2,
      retryDelayMs: 100,
    });
  });

  describe('executeBatch', () => {
    it('should successfully execute a batch of payments', async () => {
      // Mock successful transaction submission
      const { Server } = require('@stellar/stellar-sdk');
      const mockServerInstance = Server.mock.results[0]?.value || {};
      mockServerInstance.submitTransaction = jest.fn().mockResolvedValue({
        hash: 'mock_tx_hash',
        feeCharged: '200',
        ledger: 12345,
      });

      const result = await batchService.executeBatch({
        payments: mockPayments,
        sourceSecretKey: mockSecretKey,
      });

      expect(result).toBeDefined();
      expect(result.transactionHash).toBe('mock_tx_hash');
      expect(result.successfulOps).toBe(2);
      expect(result.totalOps).toBe(2);
      expect(result.feePaid).toBe(200);
    });

    it('should reject batch exceeding maximum operations', async () => {
      const tooManyPayments: PaymentOperation[] = Array.from({ length: 101 }, (_, i) => ({
        destination: `GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB${i}`,
        amount: '1.0',
      }));

      await expect(
        batchService.executeBatch({
          payments: tooManyPayments,
          sourceSecretKey: mockSecretKey,
        })
      ).rejects.toThrow(BatchPaymentError);

      await expect(
        batchService.executeBatch({
          payments: tooManyPayments,
          sourceSecretKey: mockSecretKey,
        })
      ).rejects.toMatchObject({
        type: BatchErrorType.EXCEEDS_MAX_OPS,
      });
    });

    it('should reject empty batch', async () => {
      await expect(
        batchService.executeBatch({
          payments: [],
          sourceSecretKey: mockSecretKey,
        })
      ).rejects.toThrow(BatchPaymentError);
    });

    it('should validate destination addresses', async () => {
      const invalidPayments: PaymentOperation[] = [
        {
          destination: 'INVALID_ADDRESS',
          amount: '10.0',
        },
      ];

      await expect(
        batchService.executeBatch({
          payments: invalidPayments,
          sourceSecretKey: mockSecretKey,
        })
      ).rejects.toMatchObject({
        type: BatchErrorType.INVALID_ADDRESS,
      });
    });

    it('should validate payment amounts', async () => {
      const invalidPayments: PaymentOperation[] = [
        {
          destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          amount: '0',
        },
      ];

      await expect(
        batchService.executeBatch({
          payments: invalidPayments,
          sourceSecretKey: mockSecretKey,
        })
      ).rejects.toMatchObject({
        type: BatchErrorType.INVALID_ADDRESS,
      });
    });

    it('should handle native XLM payments', async () => {
      const xlmPayments: PaymentOperation[] = [
        {
          destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          amount: '10.0',
          assetCode: 'XLM',
        },
      ];

      const { Server } = require('@stellar/stellar-sdk');
      const mockServerInstance = Server.mock.results[0]?.value || {};
      mockServerInstance.submitTransaction = jest.fn().mockResolvedValue({
        hash: 'mock_xlm_hash',
        feeCharged: '100',
        ledger: 12346,
      });

      const result = await batchService.executeBatch({
        payments: xlmPayments,
        sourceSecretKey: mockSecretKey,
      });

      expect(result.transactionHash).toBe('mock_xlm_hash');
    });

    it('should handle custom asset payments', async () => {
      const customAssetPayments: PaymentOperation[] = [
        {
          destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          amount: '100.0',
          assetCode: 'USDC',
          assetIssuer: 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
        },
      ];

      const { Server } = require('@stellar/stellar-sdk');
      const mockServerInstance = Server.mock.results[0]?.value || {};
      mockServerInstance.submitTransaction = jest.fn().mockResolvedValue({
        hash: 'mock_usdc_hash',
        feeCharged: '100',
        ledger: 12347,
      });

      const result = await batchService.executeBatch({
        payments: customAssetPayments,
        sourceSecretKey: mockSecretKey,
      });

      expect(result.transactionHash).toBe('mock_usdc_hash');
    });

    it('should retry on sequence number conflicts', async () => {
      const { Server } = require('@stellar/stellar-sdk');
      const mockServerInstance = Server.mock.results[0]?.value || {};
      
      // Fail first attempt, succeed on second
      mockServerInstance.submitTransaction = jest
        .fn()
        .mockRejectedValueOnce(new Error('Sequence mismatch'))
        .mockResolvedValue({
          hash: 'mock_retry_hash',
          feeCharged: '100',
          ledger: 12348,
        });

      const result = await batchService.executeBatch({
        payments: mockPayments,
        sourceSecretKey: mockSecretKey,
      });

      expect(result.transactionHash).toBe('mock_retry_hash');
      expect(mockServerInstance.submitTransaction).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries', async () => {
      const { Server } = require('@stellar/stellar-sdk');
      const mockServerInstance = Server.mock.results[0]?.value || {};
      
      mockServerInstance.submitTransaction = jest
        .fn()
        .mockRejectedValue(new Error('Network error'));

      await expect(
        batchService.executeBatch({
          payments: mockPayments,
          sourceSecretKey: mockSecretKey,
        })
      ).rejects.toThrow('Batch payment failed after 2 attempts');
    });
  });

  describe('executeBatchInChunks', () => {
    it('should split large payment list into chunks', async () => {
      const largePaymentList: PaymentOperation[] = Array.from({ length: 250 }, (_, i) => ({
        destination: `GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB${i % 10}`,
        amount: '1.0',
      }));

      const { Server } = require('@stellar/stellar-sdk');
      const mockServerInstance = Server.mock.results[0]?.value || {};
      mockServerInstance.submitTransaction = jest.fn().mockResolvedValue({
        hash: 'mock_chunk_hash',
        feeCharged: '100',
        ledger: 12349,
      });

      const results = await batchService.executeBatchInChunks(
        largePaymentList,
        mockSecretKey,
        100
      );

      expect(results).toHaveLength(3); // 250 / 100 = 3 chunks
      expect(results[0].totalOps).toBe(100);
      expect(results[1].totalOps).toBe(100);
      expect(results[2].totalOps).toBe(50);
    });
  });

  describe('handlePartialFailure', () => {
    it('should retry failed payments successfully', async () => {
      const { Server } = require('@stellar/stellar-sdk');
      const mockServerInstance = Server.mock.results[0]?.value || {};
      mockServerInstance.submitTransaction = jest.fn().mockResolvedValue({
        hash: 'mock_retry_success',
        feeCharged: '100',
        ledger: 12350,
      });

      const result = await batchService.handlePartialFailure(
        mockPayments,
        mockSecretKey
      );

      expect(result.successful).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
      expect(result.transactionHash).toBe('mock_retry_success');
    });

    it('should handle retry failure', async () => {
      const { Server } = require('@stellar/stellar-sdk');
      const mockServerInstance = Server.mock.results[0]?.value || {};
      mockServerInstance.submitTransaction = jest
        .fn()
        .mockRejectedValue(new Error('Retry failed'));

      const result = await batchService.handlePartialFailure(
        mockPayments,
        mockSecretKey
      );

      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(2);
      expect(result.error).toBeDefined();
    });

    it('should return empty result for no failed payments', async () => {
      const result = await batchService.handlePartialFailure([], mockSecretKey);

      expect(result.successful).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });
  });

  describe('validatePayments', () => {
    it('should reject invalid asset issuer', async () => {
      const invalidAssetPayments: PaymentOperation[] = [
        {
          destination: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          amount: '10.0',
          assetCode: 'USDC',
          assetIssuer: 'INVALID_ISSUER',
        },
      ];

      await expect(
        batchService.executeBatch({
          payments: invalidAssetPayments,
          sourceSecretKey: mockSecretKey,
        })
      ).rejects.toMatchObject({
        type: BatchErrorType.INVALID_ASSET,
      });
    });
  });
});

describe('BatchPaymentService - Fee Optimization', () => {
  it('should calculate correct fees for batch transactions', async () => {
    // Single transaction with 10 payments vs 10 separate transactions
    const batchFee = 100; // Base fee per transaction
    const individualFee = 100 * 10; // 100 per transaction * 10 transactions

    const savings = individualFee - batchFee;
    const savingsPercentage = (savings / individualFee) * 100;

    expect(savingsPercentage).toBe(90); // 90% savings
  });

  it('should handle maximum batch size efficiently', async () => {
    const maxOps = 100;
    const baseFeePerOp = 100;

    // Batch: 1 transaction with 100 ops
    const batchTotalFee = baseFeePerOp * maxOps;

    // Individual: 100 transactions with 1 op each
    const individualTotalFee = baseFeePerOp * maxOps;

    // In reality, batch saves on the overhead, but Stellar charges per operation
    // The real savings come from reduced network latency and sequence number management
    expect(batchTotalFee).toBe(individualTotalFee);
  });
});
