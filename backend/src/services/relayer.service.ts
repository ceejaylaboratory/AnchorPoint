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
  FeeBumpTransaction,
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
  FeeEstimateResponse,
  FeeBumpRequest,
  FeeBumpResponse,
} from '../types/relayer.types';

const DEFAULT_CONFIG: Partial<RelayerConfig> = {
  maxAmount: '1000000',
  allowedSpenders: [],
  expiryWindowSeconds: 3600, // 1 hour
  baseFee: 100,
  surgeMultiplier: 1.2,
  maxFeeCap: 10000,
  dynamicFeesEnabled: true,
};

export class RelayerService {
  private config: RelayerConfig;
  private relayerKeypair: Keypair;

  constructor(config?: Partial<RelayerConfig>) {
    let relayerSecretKey = config?.relayerSecretKey || '';
    let relayerPublicKey = config?.relayerPublicKey || '';

    if (!relayerSecretKey && process.env.NODE_ENV === 'test') {
      const kp = Keypair.random();
      relayerSecretKey = kp.secret();
      relayerPublicKey = kp.publicKey();
    }

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      relayerPublicKey,
      relayerSecretKey,
    } as RelayerConfig;

    if (!this.config.relayerSecretKey) {
      throw new Error('Relayer secret key is required');
    }

    this.relayerKeypair = Keypair.fromSecret(this.config.relayerSecretKey);
  }

  /**
   * Fetch dynamic fee stats from Horizon and compute recommended fee with surge multiplier & cap
   */
  async getFeeEstimate(surgeMultiplierOverride?: number): Promise<FeeEstimateResponse> {
    const network = stellarService.getNetwork();
    const fallbackBaseFee = this.config.baseFee || 100;
    const multiplier = surgeMultiplierOverride ?? this.config.surgeMultiplier ?? 1.2;
    const maxFeeCap = this.config.maxFeeCap || 10000;

    try {
      const server = stellarService.getHorizonServer(network);
      const feeStats = await server.feeStats();

      const baseFee = feeStats?.fee_charged?.min
        ? parseInt(feeStats.fee_charged.min, 10)
        : ((feeStats as any)?.min_accepted_fee ? parseInt((feeStats as any).min_accepted_fee, 10) : fallbackBaseFee);

      const modeFee = feeStats?.fee_charged?.mode
        ? parseInt(feeStats.fee_charged.mode, 10)
        : baseFee;

      const p90Fee = feeStats?.fee_charged?.p90
        ? parseInt(feeStats.fee_charged.p90, 10)
        : modeFee;

      const maxFee = feeStats?.fee_charged?.max
        ? parseInt(feeStats.fee_charged.max, 10)
        : p90Fee;

      const ledgerCapacityUsage = feeStats?.ledger_capacity_usage
        ? parseFloat(feeStats.ledger_capacity_usage)
        : 0;

      // Select reference fee based on network congestion or mode/p90
      const referenceFee = Math.max(baseFee, modeFee, p90Fee);
      const rawRecommended = Math.ceil(referenceFee * multiplier);

      // Apply max fee cap protection
      const recommendedFee = Math.min(Math.max(rawRecommended, baseFee), maxFeeCap);

      return {
        baseFee,
        recommendedFee,
        surgeMultiplier: multiplier,
        maxFeeCap,
        modeFee,
        p90Fee,
        minFee: baseFee,
        maxFee,
        ledgerCapacityUsage,
      };
    } catch (error) {
      logger.warn('Failed to fetch Horizon fee stats, falling back to static base fee:', error);
      const rawRecommended = Math.ceil(fallbackBaseFee * multiplier);
      const recommendedFee = Math.min(rawRecommended, maxFeeCap);

      return {
        baseFee: fallbackBaseFee,
        recommendedFee,
        surgeMultiplier: multiplier,
        maxFeeCap,
        modeFee: fallbackBaseFee,
        p90Fee: fallbackBaseFee,
        minFee: fallbackBaseFee,
        maxFee: fallbackBaseFee,
        ledgerCapacityUsage: 0,
      };
    }
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
   * Build a token approval transaction with dynamic fee estimation
   */
  async buildApprovalTransaction(
    request: TokenApprovalRequest,
    customFee?: number
  ): Promise<ApprovalTransaction> {
    const network = stellarService.getNetwork();
    const networkPassphrase = stellarService.getPassphrase(network);

    // Determine asset
    let asset: Asset;
    if (request.assetCode && request.assetIssuer) {
      asset = new Asset(request.assetCode, request.assetIssuer);
    } else {
      asset = Asset.native();
    }

    // Determine dynamic fee
    let feeNumber: number = customFee || 100;
    if (!customFee) {
      const estimate = await this.getFeeEstimate();
      feeNumber = estimate.recommendedFee;
    }

    // Fetch source account
    const sourceAccount = await stellarService
      .getHorizonServer(network)
      .loadAccount(this.relayerKeypair.publicKey());

    // Build transaction with approval operation
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: feeNumber.toString(),
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
      fee: feeNumber,
      operations: 1,
    };
  }

  /**
   * Build a Fee Bump transaction to resubmit a congested/underpriced transaction
   */
  async buildFeeBumpTransaction(
    innerTxXdr: string,
    bumpFeeStroops?: number,
    networkPassphrase?: string
  ): Promise<FeeBumpTransaction> {
    const network = stellarService.getNetwork();
    const passphrase = networkPassphrase || stellarService.getPassphrase(network);

    const innerTx = TransactionBuilder.fromXDR(innerTxXdr, passphrase) as Transaction;

    let feeToApply = bumpFeeStroops;
    if (!feeToApply) {
      const estimate = await this.getFeeEstimate(1.5); // Apply higher multiplier for bump
      const innerFee = parseInt(innerTx.fee, 10) || 100;
      feeToApply = Math.max(estimate.recommendedFee, innerFee * 2);
      if (this.config.maxFeeCap && feeToApply > this.config.maxFeeCap) {
        feeToApply = this.config.maxFeeCap;
      }
    }

    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
      this.relayerKeypair,
      feeToApply.toString(),
      innerTx,
      passphrase
    );

    feeBumpTx.sign(this.relayerKeypair);
    return feeBumpTx;
  }

  /**
   * Resubmit a transaction with fee bump
   */
  async submitFeeBump(request: FeeBumpRequest): Promise<FeeBumpResponse> {
    try {
      const network = stellarService.getNetwork();
      const passphrase = request.networkPassphrase || stellarService.getPassphrase(network);

      const feeBumpTx = await this.buildFeeBumpTransaction(
        request.transactionXdr,
        request.maxFee,
        passphrase
      );

      const result = await stellarService
        .getHorizonServer(network)
        .submitTransaction(feeBumpTx);

      logger.info('Fee bump transaction submitted successfully:', result.hash);

      return {
        success: true,
        feeBumpTransactionXdr: feeBumpTx.toXDR(),
        transactionHash: result.hash,
        fee: parseInt(feeBumpTx.fee, 10),
      };
    } catch (error: any) {
      logger.error('Fee bump submission error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Fee bump submission failed',
      };
    }
  }

  /**
   * Submit a signed transaction on behalf of a user with automatic fee bump retry on congestion
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

      // Verify transaction is signed
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
    } catch (error: any) {
      logger.error('Transaction submission error:', error);
      const isFeeError =
        error?.response?.data?.extras?.result_codes?.transaction === 'tx_insufficient_fee' ||
        /insufficient fee|fee too small/i.test(error?.message || '');

      // If submission failed due to fee congestion, attempt fee bump resubmission
      if (isFeeError) {
        logger.warn('Encountered tx_insufficient_fee, attempting automatic fee bump resubmission...');
        try {
          const bumpResult = await this.submitFeeBump({
            transactionXdr: request.signedTransactionXdr,
            networkPassphrase: request.networkPassphrase,
          });

          if (bumpResult.success && bumpResult.transactionHash) {
            return {
              success: true,
              transactionHash: bumpResult.transactionHash,
            };
          }
        } catch (bumpErr) {
          logger.error('Automatic fee bump resubmission failed:', bumpErr);
        }
      }

      if (error?.response?.data?.extras) {
        logger.error('Horizon error details:', {
          resultCodes: error.response.data.extras.result_codes,
          xdr: error.response.data.extras.envelope_xdr,
        });
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Submission failed',
      };
    }
  }

  /**
   * Process a token approval request end-to-end with dynamic fee estimation and queueing
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

    // Build transaction with dynamic fee estimation
    const approvalTx = await this.buildApprovalTransaction(request);

    // Submit transaction with fee bump fallback
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
   * Verify Ed25519 signature
   */
  private verifyEd25519Signature(
    message: string,
    signature: Buffer,
    publicKey: Buffer
  ): boolean {
    try {
      const crypto = require('crypto');
      const messageBuffer = Buffer.from(message, 'utf8');
      
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
  baseFee: parseInt(process.env.RELAYER_BASE_FEE || '100', 10),
  surgeMultiplier: parseFloat(process.env.RELAYER_FEE_SURGE_MULTIPLIER || '1.2'),
  maxFeeCap: parseInt(process.env.RELAYER_MAX_FEE_CAP || '10000', 10),
  dynamicFeesEnabled: process.env.RELAYER_DYNAMIC_FEES_ENABLED !== 'false',
});

