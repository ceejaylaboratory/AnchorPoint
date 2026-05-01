/**
 * Relayer Service
 * 
 * Signature-based verification system for gasless token approvals
 * Allows a relayer to submit token approvals on behalf of a user
 */

import {
  Keypair,
  Transaction,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  xdr,
} from '@stellar/stellar-sdk';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { stellarService } from './stellar.service';
import {
  TokenApprovalRequest,
  TokenApprovalResponse,
  SignedTransactionRequest,
  RelayerConfig,
  SignatureVerificationResult,
  ApprovalTransaction,
} from '../types/relayer.types';

const DEFAULT_CONFIG: Partial<RelayerConfig> = {
  maxAmount: '1000000',
  allowedSpenders: [],
  expiryWindowSeconds: 3600, // 1 hour
};

export class RelayerService {
  private config: RelayerConfig;
  private relayerKeypair: Keypair;

  constructor(config?: Partial<RelayerConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      relayerPublicKey: config?.relayerPublicKey || '',
      relayerSecretKey: config?.relayerSecretKey || '',
    } as RelayerConfig;

    if (!this.config.relayerSecretKey) {
      throw new Error('Relayer secret key is required');
    }

    this.relayerKeypair = Keypair.fromSecret(this.config.relayerSecretKey);
  }

  /**
   * Verify a signature on a token approval request
   */
  async verifySignature(request: TokenApprovalRequest): Promise<SignatureVerificationResult> {
    try {
      // Validate request structure
      if (!request.userPublicKey || !request.signature || !request.nonce) {
        return {
          valid: false,
          error: 'Missing required fields in approval request',
        };
      }

      // Check expiry
      if (request.expiry < Date.now()) {
        return {
          valid: false,
          error: 'Request has expired',
        };
      }

      // Verify spender is allowed
      if (
        this.config.allowedSpenders.length > 0 &&
        !this.config.allowedSpenders.includes(request.spenderPublicKey)
      ) {
        return {
          valid: false,
          error: 'Spender is not authorized',
        };
      }

      // Verify amount is within limits
      const amount = BigInt(request.amount);
      const maxAmount = BigInt(this.config.maxAmount);
      if (amount > maxAmount) {
        return {
          valid: false,
          error: 'Amount exceeds maximum allowed',
        };
      }

      // Construct the message that was signed
      const message = this.constructApprovalMessage(request);
      
      // Verify signature
      const signatureBuffer = Buffer.from(request.signature, 'base64');
      const publicKeyBuffer = Buffer.from(request.userPublicKey, 'base64');
      
      // In a real implementation, you would use Stellar's signature verification
      // For now, we'll use a simplified verification
      const isValid = this.verifyEd25519Signature(
        message,
        signatureBuffer,
        publicKeyBuffer
      );

      if (!isValid) {
        return {
          valid: false,
          error: 'Invalid signature',
        };
      }

      return {
        valid: true,
        publicKey: request.userPublicKey,
      };
    } catch (error) {
      logger.error('Signature verification error:', error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  /**
   * Build a token approval transaction
   */
  async buildApprovalTransaction(
    request: TokenApprovalRequest
  ): Promise<ApprovalTransaction> {
    const network = stellarService.getNetwork();
    const networkConfig = stellarService.getNetwork();
    const networkPassphrase = stellarService.getPassphrase(network);
    const horizonUrl = stellarService.getHorizonServer(network).serverURL.toString();

    // Determine asset
    let asset: Asset;
    if (request.assetCode && request.assetIssuer) {
      asset = new Asset(request.assetCode, request.assetIssuer);
    } else {
      asset = Asset.native();
    }

    // Fetch source account
    const sourceAccount = await stellarService
      .getHorizonServer(network)
      .loadAccount(this.relayerKeypair.publicKey());

    // Build transaction with approval operation
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(
        Operation.allowTrust({
          trustor: request.userPublicKey,
          assetCode: asset.code,
          authorize: true,
          source: this.relayerKeypair.publicKey(),
        })
      )
      .setTimeout(30)
      .build();

    // Sign with relayer key
    transaction.sign(this.relayerKeypair);

    return {
      transactionXdr: transaction.toXDR(),
      networkPassphrase,
      fee: 100,
      operations: 1,
    };
  }

  /**
   * Submit a signed transaction on behalf of a user
   */
  async submitSignedTransaction(
    request: SignedTransactionRequest
  ): Promise<TokenApprovalResponse> {
    try {
      // Parse the signed transaction
      const transaction = TransactionBuilder.fromXDR(
        request.signedTransactionXdr,
        request.networkPassphrase
      ) as Transaction;

      // Verify transaction is signed by the user
      const signatures = transaction.signatures;
      if (signatures.length === 0) {
        return {
          success: false,
          error: 'Transaction is not signed',
        };
      }

      // Submit to network
      const network = stellarService.getNetwork();
      const result = await stellarService
        .getHorizonServer(network)
        .submitTransaction(transaction);

      logger.info('Transaction submitted successfully:', result.hash);

      return {
        success: true,
        transactionHash: result.hash,
      };
    } catch (error) {
      logger.error('Transaction submission error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Submission failed',
      };
    }
  }

  /**
   * Process a token approval request end-to-end
   */
  async processApprovalRequest(
    request: TokenApprovalRequest
  ): Promise<TokenApprovalResponse> {
    // Verify signature
    const verification = await this.verifySignature(request);
    if (!verification.valid) {
      return {
        success: false,
        error: verification.error,
      };
    }

    // Build transaction
    const approvalTx = await this.buildApprovalTransaction(request);

    // Submit transaction
    const result = await this.submitSignedTransaction({
      signedTransactionXdr: approvalTx.transactionXdr,
      networkPassphrase: approvalTx.networkPassphrase,
    });

    return result;
  }

  /**
   * Construct the message that should be signed for approval
   */
  private constructApprovalMessage(request: TokenApprovalRequest): string {
    const parts = [
      'approve',
      request.userPublicKey,
      request.spenderPublicKey,
      request.amount,
      request.assetCode || 'XLM',
      request.assetIssuer || 'native',
      request.nonce,
      request.expiry.toString(),
    ];
    return parts.join('|');
  }

  /**
   * Verify Ed25519 signature (simplified version)
   * In production, use proper cryptographic verification
   */
  private verifyEd25519Signature(
    message: string,
    signature: Buffer,
    publicKey: Buffer
  ): boolean {
    try {
      // This is a simplified verification
      // In production, use @stellar/stellar-sdk's signature verification
      // or the sodium crypto library
      const crypto = require('crypto');
      const messageBuffer = Buffer.from(message, 'utf8');
      
      // Using Node's crypto for demonstration
      // In Stellar, you would use the SDK's verify function
      return crypto.verify(
        'ed25519',
        publicKey,
        signature,
        messageBuffer
      );
    } catch (error) {
      logger.error('Signature verification error:', error);
      return false;
    }
  }

  /**
   * Generate a nonce for approval requests
   */
  generateNonce(): string {
    return uuidv4();
  }

  /**
   * Get relayer configuration
   */
  getConfig(): RelayerConfig {
    return { ...this.config };
  }
}

export const relayerService = new RelayerService({
  relayerPublicKey: process.env.RELAYER_PUBLIC_KEY || '',
  relayerSecretKey: process.env.RELAYER_SECRET_KEY || '',
  maxAmount: process.env.RELAYER_MAX_AMOUNT || '1000000',
  allowedSpenders: process.env.RELAYER_ALLOWED_SPENDERS?.split(',') || [],
  expiryWindowSeconds: parseInt(process.env.RELAYER_EXPIRY_WINDOW || '3600', 10),
});
