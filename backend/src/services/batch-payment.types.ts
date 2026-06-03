/**
 * Batch Payment Types and Interfaces
 * 
 * Defines the data structures for batching multiple Stellar payments
 * into a single transaction to reduce network fees.
 */

export interface PaymentOperation {
  /** Destination Stellar address */
  destination: string;
  /** Amount to send (as string to preserve precision) */
  amount: string;
  /** Asset code (e.g., 'XLM', 'USDC'). Undefined for native XLM */
  assetCode?: string;
  /** Asset issuer address (required for non-native assets) */
  assetIssuer?: string;
  /** Optional memo for the payment */
  memo?: string;
}

export interface BatchPaymentRequest {
  /** Array of payment operations to batch (max 100) */
  payments: PaymentOperation[];
  /** Source account secret key for signing (deprecated - use encryptedKey or keyId) */
  sourceSecretKey?: string;
  /** Encrypted key for signing (new secure method) */
  encryptedKey?: {
    ciphertext: string;
    keyVersion: string;
    algorithm: string;
    timestamp: number;
  };
  /** Key ID for vault/KMS retrieval (alternative secure method) */
  keyId?: string;
  /** Optional base fee in stroops (default: 100) */
  baseFee?: number;
  /** Optional timeout in seconds (default: 300) */
  timeoutInSeconds?: number;
}

export interface BatchPaymentResult {
  /** Stellar transaction hash */
  transactionHash: string;
  /** Number of successful operations */
  successfulOps: number;
  /** Total number of operations in the batch */
  totalOps: number;
  /** Transaction fee paid in stroops */
  feePaid: number;
  /** Sequence number used */
  sequenceNumber: string;
  /** Ledger where transaction was included */
  ledger?: number;
  /** Timestamp of successful submission */
  timestamp?: Date;
}

export interface PartialFailureResult {
  /** Successfully processed payments */
  successful: PaymentOperation[];
  /** Failed payments with error details */
  failed: {
    payment: PaymentOperation;
    error: string;
    operationIndex: number;
  }[];
  /** Transaction hash if partially successful */
  transactionHash?: string;
  /** Error message for the overall batch */
  error?: string;
}

export interface BatchStatus {
  /** Unique batch ID */
  batchId: string;
  /** Current status of the batch */
  status: 'pending' | 'processing' | 'success' | 'partial_failure' | 'failed';
  /** Number of operations */
  operationCount: number;
  /** Created timestamp */
  createdAt: Date;
  /** Completed timestamp */
  completedAt?: Date;
  /** Result data */
  result?: BatchPaymentResult | PartialFailureResult;
}

export enum BatchErrorType {
  /** Too many operations in batch */
  EXCEEDS_MAX_OPS = 'EXCEEDS_MAX_OPS',
  /** Invalid Stellar address */
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  /** Insufficient balance */
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  /** Sequence number conflict */
  SEQUENCE_CONFLICT = 'SEQUENCE_CONFLICT',
  /** Network error */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** Transaction failed */
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  /** Invalid asset */
  INVALID_ASSET = 'INVALID_ASSET',
}

export class BatchPaymentError extends Error {
  public type: BatchErrorType;
  public details?: any;

  constructor(type: BatchErrorType, message: string, details?: any) {
    super(message);
    this.name = 'BatchPaymentError';
    this.type = type;
    this.details = details;
  }
}

/**
 * Configuration for the batch payment service
 */
export interface BatchPaymentConfig {
  /** Maximum operations per batch (Stellar limit: 100) */
  maxOperationsPerBatch: number;
  /** Redis key prefix for sequence number locks */
  redisKeyPrefix: string;
  /** Lock timeout in seconds for sequence numbers */
  lockTimeoutSeconds: number;
  /** Number of retry attempts for failed transactions */
  maxRetries: number;
  /** Delay between retries in milliseconds */
  retryDelayMs: number;
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** Horizon server URL */
  horizonUrl: string;
}
