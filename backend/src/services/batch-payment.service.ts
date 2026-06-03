/**
 * Batch Payment Service
 * 
 * Handles batching multiple Stellar payments into a single transaction
 * to reduce network fees. Manages sequence numbers, handles partial failures,
 * and provides retry logic.
 * 
 * Security Note: This service retrieves provider keys from the key management service.
 * Keys are never stored in plaintext or logged.
 */

import {
  Keypair,
  Server,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  StrKey,
  Account,
  Horizon,
} from '@stellar/stellar-sdk';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { SequenceNumberManager } from './sequence-number.service';
import { getKeyManagementService } from '../lib/key-management.service';
import { KeyManagementError } from '../lib/key-management.types';
import {
  BatchPaymentRequest,
  BatchPaymentResult,
  PartialFailureResult,
  BatchStatus,
  BatchPaymentError,
  BatchErrorType,
  PaymentOperation,
  BatchPaymentConfig,
} from './batch-payment.types';

const DEFAULT_CONFIG: Partial<BatchPaymentConfig> = {
  maxOperationsPerBatch: 100,
  redisKeyPrefix: 'stellar:batch',
  lockTimeoutSeconds: 30,
  maxRetries: 3,
  retryDelayMs: 1000,
  networkPassphrase: Networks.TESTNET,
  horizonUrl: 'https://horizon-testnet.stellar.org',
};

export class BatchPaymentService {
  private config: BatchPaymentConfig;
  private server: Server;
  private sequenceManager: SequenceNumberManager;

  constructor(config?: Partial<BatchPaymentConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as BatchPaymentConfig;

    this.server = new Server(this.config.horizonUrl);
    this.sequenceManager = new SequenceNumberManager(
      this.config.redisKeyPrefix,
      this.config.lockTimeoutSeconds
    );
  }

  /**
   * Execute a batch of payments in a single Stellar transaction
   * 
   * Security Note: This method retrieves the signing key from the key management service.
   * The key is held in memory only for the duration of the signing operation.
   */
  async executeBatch(request: BatchPaymentRequest): Promise<BatchPaymentResult> {
    const batchId = uuidv4();
    logger.info(`[Batch ${batchId}] Starting batch payment with ${request.payments.length} operations`);

    // Validate batch size
    if (request.payments.length > this.config.maxOperationsPerBatch) {
      throw new BatchPaymentError(
        BatchErrorType.EXCEEDS_MAX_OPS,
        `Batch exceeds maximum operations: ${request.payments.length} > ${this.config.maxOperationsPerBatch}`
      );
    }

    if (request.payments.length === 0) {
      throw new BatchPaymentError(
        BatchErrorType.INVALID_ADDRESS,
        'Batch contains no payment operations'
      );
    }

    // Validate all addresses
    this.validatePayments(request.payments);

    // Retrieve source secret key from key management service or request
    let sourceSecretKey: string;
    try {
      if (request.encryptedKey) {
        // Decrypt key from encrypted blob
        const keyManagementService = getKeyManagementService();
        sourceSecretKey = await keyManagementService.decryptKey(request.encryptedKey);
      } else if (request.keyId) {
        // Retrieve key by ID from vault/KMS
        const keyManagementService = getKeyManagementService();
        sourceSecretKey = await keyManagementService.getKeyByReference(request.keyId);
      } else if (request.sourceSecretKey) {
        // Fallback to plaintext key (deprecated, for backward compatibility)
        logger.warn('[Batch] Using plaintext sourceSecretKey - consider using encrypted key or keyId');
        sourceSecretKey = request.sourceSecretKey;
      } else {
        throw new BatchPaymentError(
          BatchErrorType.TRANSACTION_FAILED,
          'No source secret key provided. Use encryptedKey, keyId, or sourceSecretKey.'
        );
      }
    } catch (error) {
      if (error instanceof KeyManagementError) {
        throw new BatchPaymentError(
          BatchErrorType.TRANSACTION_FAILED,
          `Failed to retrieve signing key: ${error.message}`
        );
      }
      throw error;
    }

    // Get source account from secret key
    const sourceKeypair = Keypair.fromSecret(sourceSecretKey);
    const sourcePublicKey = sourceKeypair.publicKey();

    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < this.config.maxRetries) {
      attempts++;
      logger.info(`[Batch ${batchId}] Attempt ${attempts}/${this.config.maxRetries}`);

      try {
        // Fetch current sequence from network
        const baseSequence = await this.sequenceManager.fetchSequenceFromNetwork(
          sourcePublicKey,
          this.server
        );

        // Acquire lock and get next sequence number
        const lockValue = await this.sequenceManager.acquireLock(sourcePublicKey);

        try {
          // Calculate sequence number for this transaction
          const sequenceNumber = await this.sequenceManager.getNextSequenceNumber(
            sourcePublicKey,
            baseSequence
          );

          // Build and submit transaction
          const result = await this.buildAndSubmitTransaction(
            batchId,
            sourceKeypair,
            sequenceNumber,
            request.payments,
            request.baseFee,
            request.timeoutInSeconds
          );

          // Reset sequence counter after successful submission
          await this.sequenceManager.resetSequenceCounter(sourcePublicKey, result.sequenceNumber);

          logger.info(`[Batch ${batchId}] Successfully submitted transaction: ${result.transactionHash}`);
          return result;
        } finally {
          await this.sequenceManager.releaseLock(sourcePublicKey, lockValue);
        }
      } catch (error) {
        lastError = error as Error;
        logger.error(`[Batch ${batchId}] Attempt ${attempts} failed: ${error}`);

        // If it's a sequence number error, retry immediately
        if (error instanceof BatchPaymentError && error.type === BatchErrorType.SEQUENCE_CONFLICT) {
          logger.warn(`[Batch ${batchId}] Sequence conflict, retrying...`);
          continue;
        }

        // Wait before retrying for other errors
        if (attempts < this.config.maxRetries) {
          await this.delay(this.config.retryDelayMs * attempts);
        }
      }
    }

    throw new BatchPaymentError(
      BatchErrorType.TRANSACTION_FAILED,
      `Batch payment failed after ${this.config.maxRetries} attempts: ${lastError?.message}`,
      { lastError }
    );
  }

  /**
   * Split large payment list into multiple batches and execute them
   */
  async executeBatchInChunks(
    payments: PaymentOperation[],
    sourceSecretKey?: string,
    chunkSize: number = 100,
    encryptedKey?: any,
    keyId?: string
  ): Promise<BatchPaymentResult[]> {
    const results: BatchPaymentResult[] = [];
    const chunks = this.chunkArray(payments, chunkSize);

    logger.info(`Splitting ${payments.length} payments into ${chunks.length} batches`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      logger.info(`Processing batch ${i + 1}/${chunks.length} with ${chunk.length} payments`);

      const result = await this.executeBatch({
        payments: chunk,
        sourceSecretKey,
        encryptedKey,
        keyId,
      });

      results.push(result);
    }

    return results;
  }

  /**
   * Handle partial batch failures by retrying failed operations
   */
  async handlePartialFailure(
    failedPayments: PaymentOperation[],
    sourceSecretKey?: string,
    encryptedKey?: any,
    keyId?: string
  ): Promise<PartialFailureResult> {
    if (failedPayments.length === 0) {
      return { successful: [], failed: [] };
    }

    logger.info(`Attempting to retry ${failedPayments.length} failed payments`);

    try {
      const result = await this.executeBatch({
        payments: failedPayments,
        sourceSecretKey,
        encryptedKey,
        keyId,
      });

      return {
        successful: failedPayments,
        failed: [],
        transactionHash: result.transactionHash,
      };
    } catch (error) {
      logger.error(`Partial failure retry failed: ${error}`);
      
      return {
        successful: [],
        failed: failedPayments.map((payment, index) => ({
          payment,
          error: error instanceof Error ? error.message : 'Unknown error',
          operationIndex: index,
        })),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Build and submit a Stellar transaction with multiple payment operations
   */
  private async buildAndSubmitTransaction(
    batchId: string,
    sourceKeypair: Keypair,
    sequenceNumber: string,
    payments: PaymentOperation[],
    baseFee?: number,
    timeoutInSeconds?: number
  ): Promise<BatchPaymentResult> {
    const sourcePublicKey = sourceKeypair.publicKey();

    // Create account object with the sequence number
    const sourceAccount = new Account(sourcePublicKey, sequenceNumber);

    // Build transaction
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: String(baseFee || 100), // Base fee in stroops
      networkPassphrase: this.config.networkPassphrase,
      timebounds: {
        minTime: 0,
        maxTime: Math.floor(Date.now() / 1000) + (timeoutInSeconds || 300),
      },
    });

    // Add payment operations
    payments.forEach((payment, index) => {
      const asset = this.createAsset(payment.assetCode, payment.assetIssuer);

      transaction.addOperation(
        Operation.payment({
          destination: payment.destination,
          asset: asset,
          amount: payment.amount,
        })
      );

      logger.debug(`[Batch ${batchId}] Added payment operation ${index + 1}: ${payment.amount} to ${payment.destination}`);
    });

    // Build transaction
    const builtTransaction = transaction.build();

    // Sign transaction
    builtTransaction.sign(sourceKeypair);

    // Submit to network
    logger.info(`[Batch ${batchId}] Submitting transaction with ${payments.length} operations`);
    
    try {
      const submitResponse = await this.server.submitTransaction(builtTransaction);

      const result: BatchPaymentResult = {
        transactionHash: submitResponse.hash,
        successfulOps: payments.length,
        totalOps: payments.length,
        feePaid: parseInt(submitResponse.feeCharged, 10),
        sequenceNumber: sequenceNumber,
        ledger: submitResponse.ledger,
        timestamp: new Date(),
      };

      logger.info(
        `[Batch ${batchId}] Transaction successful: hash=${submitResponse.hash}, fee=${submitResponse.feeCharged}, ledger=${submitResponse.ledger}`
      );

      return result;
    } catch (error: unknown) {
      logger.error(`[Batch ${batchId}] Transaction submission failed: ${error}`);
      
      // Check if it's a HorizonApi error with result codes
      if (error && typeof error === 'object' && 'response' in error) {
        const horizonError = error as Horizon.HorizonApi.ErrorResponse;
        
        // Handle partial failure scenarios
        if (horizonError.extras?.result_codes) {
          const resultCodes = horizonError.extras.result_codes;
          
          logger.error(`[Batch ${batchId}] Result codes: ${JSON.stringify(resultCodes)}`);
          
          // If some operations succeeded, we can retry the failed ones
          if (resultCodes.operations && Array.isArray(resultCodes.operations)) {
            const failedOps = resultCodes.operations.filter(
              (code: string) => code !== 'op_success'
            );

            if (failedOps.length > 0 && failedOps.length < payments.length) {
              logger.warn(
                `[Batch ${batchId}] Partial failure: ${failedOps.length}/${payments.length} operations failed`
              );
            }
          }
        }
      }

      throw new BatchPaymentError(
        BatchErrorType.TRANSACTION_FAILED,
        `Transaction submission failed: ${error}`,
        { error }
      );
    }
  }

  /**
   * Validate payment operations
   */
  private validatePayments(payments: PaymentOperation[]): void {
    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i];

      // Validate destination address
      if (!StrKey.isValidEd25519PublicKey(payment.destination)) {
        throw new BatchPaymentError(
          BatchErrorType.INVALID_ADDRESS,
          `Invalid destination address at index ${i}: ${payment.destination}`
        );
      }

      // Validate amount
      if (!payment.amount || parseFloat(payment.amount) <= 0) {
        throw new BatchPaymentError(
          BatchErrorType.INVALID_ADDRESS,
          `Invalid amount at index ${i}: ${payment.amount}`
        );
      }

      // Validate asset if specified
      if (payment.assetCode && payment.assetCode !== 'XLM') {
        if (!payment.assetIssuer || !StrKey.isValidEd25519PublicKey(payment.assetIssuer)) {
          throw new BatchPaymentError(
            BatchErrorType.INVALID_ASSET,
            `Invalid asset issuer at index ${i} for asset ${payment.assetCode}`
          );
        }
      }
    }
  }

  /**
   * Create Stellar Asset object
   */
  private createAsset(assetCode?: string, assetIssuer?: string): Asset {
    if (!assetCode || assetCode === 'XLM') {
      return Asset.native();
    }

    if (!assetIssuer) {
      throw new BatchPaymentError(
        BatchErrorType.INVALID_ASSET,
        `Asset issuer required for ${assetCode}`
      );
    }

    return new Asset(assetCode, assetIssuer);
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Delay utility function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get batch status (for tracking purposes)
   */
  async getBatchStatus(batchId: string): Promise<BatchStatus | null> {
    // This would typically query a database
    // For now, return null as we're not storing batch status
    return null;
  }
}
