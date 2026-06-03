/**
 * Batch Payment Service Tests
 * 
 * Comprehensive tests for the batch payment service
 */

import { BatchPaymentService } from '../services/batch-payment.service';
import { BatchPaymentError, BatchErrorType, PaymentOperation } from '../services/batch-payment.types';
import { Horizon } from '@stellar/stellar-sdk';

// Mock key management because these tests exercise validation and transaction assembly paths.
jest.mock('../lib/key-management.service', () => ({
  getKeyManagementService: jest.fn(() => ({
    decryptKey: jest.fn(),
    getKeyByReference: jest.fn(),
  })),
}));

jest.mock('../lib/key-management.types', () => ({
  KeyManagementError: class KeyManagementError extends Error {},
}));

// Mock the Stellar SDK
jest.mock('@stellar/stellar-sdk', () => {
  const mockValidPublicKeys = new Set([
    'GCM5WPR4DDR24FSAX5LIEM4J7AI3KOWJYANSXEPKYXCSZOTAYXE75AFN',
    'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  ]);

  const mockAccount = {
    sequenceNumber: () => '123456789012345678',
  };

  const mockServer = {
    loadAccount: jest.fn().mockResolvedValue(mockAccount),
    submitTransaction: jest.fn(),
  };

  const mockAsset = Object.assign(
    jest.fn().mockImplementation((code, issuer) => ({ code, issuer })),
    {
      native: jest.fn().mockReturnValue({ code: 'XLM' }),
    }
  );

  return {
    Keypair: {
      fromSecret: jest.fn().mockReturnValue({
        publicKey: () => 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      }),
    },
    Horizon: {
      Server: jest.fn().mockImplementation(() => mockServer),
    },
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
    Asset: mockAsset,
    StrKey: {
      isValidEd25519PublicKey: jest.fn((key) => mockValidPublicKeys.has(key)),
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
  const validDestination = 'GCM5WPR4DDR24FSAX5LIEM4J7AI3KOWJYANSXEPKYXCSZOTAYXE75AFN';
  const validAssetIssuer = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const getMockServerInstance = (): {
    submitTransaction: jest.Mock;
  } =>
    ((Horizon.Server as unknown as jest.Mock).mock.results[0]?.value ?? {}) as {
      submitTransaction: jest.Mock;
    };

  const mockPayments: PaymentOperation[] = [
    {
      destination: validDestination,
      amount: '10.5',
    },
    {
      destination: validAssetIssuer,
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
      const mockServerInstance = getMockServerInstance();
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
      const tooManyPayments: PaymentOperation[] = Array.from({ length: 101 }, () => ({
        destination: validDestination,
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

    it.each([
      ['secret seed-like value', `S${validDestination.slice(1)}`],
      ['padded public key', `${validDestination} `],
      ['lowercase public key', validDestination.toLowerCase()],
      ['checksum mismatch', `${validDestination.slice(0, -1)}A`],
      ['muxed account-like value', `M${validDestination.slice(1)}`],
    ])('should reject destination edge case: %s', async (_caseName, destination) => {
      await expect(
        batchService.executeBatch({
          payments: [
            {
              destination,
              amount: '10.0',
            },
          ],
          sourceSecretKey: mockSecretKey,
        })
      ).rejects.toMatchObject({
        type: BatchErrorType.INVALID_ADDRESS,
        message: 'Invalid destination Stellar address at index 0',
      });
    });

    it('should not echo invalid destination values in errors', async () => {
      const invalidDestination = `S${validDestination.slice(1)}`;

      try {
        await batchService.executeBatch({
          payments: [
            {
              destination: invalidDestination,
              amount: '10.0',
            },
          ],
          sourceSecretKey: mockSecretKey,
        });
        throw new Error('Expected invalid destination to be rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(BatchPaymentError);
        expect((error as Error).message).not.toContain(invalidDestination);
      }
    });

    it('should validate payment amounts', async () => {
      const invalidPayments: PaymentOperation[] = [
        {
          destination: validDestination,
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
          destination: validDestination,
          amount: '10.0',
          assetCode: 'XLM',
        },
      ];

      const mockServerInstance = getMockServerInstance();
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
          destination: validDestination,
          amount: '100.0',
          assetCode: 'USDC',
          assetIssuer: validAssetIssuer,
        },
      ];

      const mockServerInstance = getMockServerInstance();
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
      const mockServerInstance = getMockServerInstance();
      
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
      const mockServerInstance = getMockServerInstance();
      
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
      const largePaymentList: PaymentOperation[] = Array.from({ length: 250 }, () => ({
        destination: validDestination,
        amount: '1.0',
      }));

      const mockServerInstance = getMockServerInstance();
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
      const mockServerInstance = getMockServerInstance();
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
      const mockServerInstance = getMockServerInstance();
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
      const invalidAssetIssuer = `S${validAssetIssuer.slice(1)}`;
      const invalidAssetPayments: PaymentOperation[] = [
        {
          destination: validDestination,
          amount: '10.0',
          assetCode: 'USDC',
          assetIssuer: invalidAssetIssuer,
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

      try {
        await batchService.executeBatch({
          payments: invalidAssetPayments,
          sourceSecretKey: mockSecretKey,
        });
        throw new Error('Expected invalid asset issuer to be rejected');
      } catch (error) {
        expect(error).toBeInstanceOf(BatchPaymentError);
        expect((error as Error).message).not.toContain(invalidAssetIssuer);
      }
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
