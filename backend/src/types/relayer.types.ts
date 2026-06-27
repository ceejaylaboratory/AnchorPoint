/**
 * Relayer Types
 * 
 * Types for signature-based gasless token approval system
 */

export interface TokenApprovalRequest {
  userPublicKey: string;
  spenderPublicKey: string;
  amount: string;
  assetCode?: string;
  assetIssuer?: string;
  nonce: string;
  expiry: number; // Unix timestamp
  signature: string; // Base64 encoded signature
}

export interface TokenApprovalResponse {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

export interface SignedTransactionRequest {
  signedTransactionXdr: string;
  networkPassphrase: string;
}

export interface RelayerConfig {
  relayerPublicKey: string;
  relayerSecretKey: string;
  maxAmount: string;
  allowedSpenders: string[];
  expiryWindowSeconds: number;
}

export interface SignatureVerificationResult {
  valid: boolean;
  publicKey?: string;
  error?: string;
}

export interface ApprovalTransaction {
  transactionXdr: string;
  networkPassphrase: string;
  fee: number;
  operations: number;
}
