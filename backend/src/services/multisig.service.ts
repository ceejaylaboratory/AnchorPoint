import * as StellarSdk from '@stellar/stellar-sdk';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { MultisigStatus } from '@prisma/client';

export interface CreateMultisigTransactionParams {
  envelopeXdr: string;
  creatorPublicKey: string;
  requiredSigners: string[];
  threshold: number;
  memo?: string;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

export interface AddSignatureParams {
  transactionId: string;
  signerPublicKey: string;
  signedEnvelopeXdr: string;
}

export interface MultisigTransactionDetails {
  id: string;
  hash: string;
  envelopeXdr: string;
  creatorPublicKey: string;
  requiredSigners: string[];
  threshold: number;
  currentSignatures: number;
  status: MultisigStatus;
  signatures: Array<{
    signerPublicKey: string;
    signedAt: Date;
  }>;
  memo?: string;
  expiresAt?: Date;
  submittedAt?: Date;
  stellarTxId?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

class MultisigService {
  /**
   * Create a new multisig transaction
   */
  async createTransaction(params: CreateMultisigTransactionParams): Promise<MultisigTransactionDetails> {
    const {
      envelopeXdr,
      creatorPublicKey,
      requiredSigners,
      threshold,
      memo,
      expiresAt,
      metadata,
    } = params;

    // Validate the transaction envelope
    let transaction: StellarSdk.Transaction;
    try {
      transaction = new StellarSdk.TransactionBuilder.fromXDR(
        envelopeXdr,
        StellarSdk.Networks.TESTNET
      ) as StellarSdk.Transaction;
    } catch (error) {
      throw new Error('Invalid transaction envelope XDR');
    }

    // Get transaction hash
    const hash = transaction.hash().toString('hex');

    // Validate threshold
    if (threshold < 1 || threshold > requiredSigners.length) {
      throw new Error('Invalid threshold: must be between 1 and number of required signers');
    }

    // Validate required signers
    if (requiredSigners.length === 0) {
      throw new Error('At least one required signer must be specified');
    }

    // Check for duplicate signers
    const uniqueSigners = new Set(requiredSigners);
    if (uniqueSigners.size !== requiredSigners.length) {
      throw new Error('Duplicate signers are not allowed');
    }

    // Validate expiration
    if (expiresAt && expiresAt <= new Date()) {
      throw new Error('Expiration date must be in the future');
    }

    // Create the multisig transaction
    const multisigTx = await prisma.multisigTransaction.create({
      data: {
        envelopeXdr,
        hash,
        creatorPublicKey,
        requiredSigners: requiredSigners,
        threshold,
        memo,
        expiresAt,
        metadata: metadata || {},
        status: MultisigStatus.PENDING,
        currentSignatures: 0,
      },
      include: {
        signatures: true,
      },
    });

    logger.info(`Created multisig transaction ${multisigTx.id} with hash ${hash}`);

    // Send notifications to required signers
    await this.notifyRequiredSigners(multisigTx.id, requiredSigners);

    return this.formatTransactionDetails(multisigTx);
  }

  /**
   * Add a signature to a multisig transaction
   */
  async addSignature(params: AddSignatureParams): Promise<MultisigTransactionDetails> {
    const { transactionId, signerPublicKey, signedEnvelopeXdr } = params;

    // Get the multisig transaction
    const multisigTx = await prisma.multisigTransaction.findUnique({
      where: { id: transactionId },
      include: { signatures: true },
    });

    if (!multisigTx) {
      throw new Error('Multisig transaction not found');
    }

    // Check if transaction is still pending or partially signed
    if (multisigTx.status !== MultisigStatus.PENDING && multisigTx.status !== MultisigStatus.PARTIALLY_SIGNED) {
      throw new Error(`Cannot add signature: transaction is ${multisigTx.status}`);
    }

    // Check if transaction has expired
    if (multisigTx.expiresAt && multisigTx.expiresAt <= new Date()) {
      await this.markAsExpired(transactionId);
      throw new Error('Transaction has expired');
    }

    // Check if signer is in the required signers list
    const requiredSigners = multisigTx.requiredSigners as string[];
    if (!requiredSigners.includes(signerPublicKey)) {
      throw new Error('Signer is not in the required signers list');
    }

    // Check if signer has already signed
    const existingSignature = multisigTx.signatures.find(
      sig => sig.signerPublicKey === signerPublicKey
    );
    if (existingSignature) {
      throw new Error('Signer has already signed this transaction');
    }

    // Validate the signed envelope
    let signedTransaction: StellarSdk.Transaction;
    try {
      signedTransaction = new StellarSdk.TransactionBuilder.fromXDR(
        signedEnvelopeXdr,
        StellarSdk.Networks.TESTNET
      ) as StellarSdk.Transaction;
    } catch (error) {
      throw new Error('Invalid signed transaction envelope XDR');
    }

    // Verify the transaction hash matches
    const signedHash = signedTransaction.hash().toString('hex');
    if (signedHash !== multisigTx.hash) {
      throw new Error('Signed transaction hash does not match original transaction');
    }

    // Extract the signature for this signer
    const signature = this.extractSignature(signedTransaction, signerPublicKey);
    if (!signature) {
      throw new Error('Valid signature not found in signed envelope');
    }

    // Add the signature
    await prisma.multisigSignature.create({
      data: {
        multisigTransactionId: transactionId,
        signerPublicKey,
        signature,
      },
    });

    const newSignatureCount = multisigTx.currentSignatures + 1;

    // Update the transaction with the new signature
    const updatedStatus = newSignatureCount >= multisigTx.threshold
      ? MultisigStatus.READY
      : MultisigStatus.PARTIALLY_SIGNED;

    // Merge the new signature into the envelope
    const mergedEnvelope = await this.mergeSignatures(multisigTx.envelopeXdr, signedEnvelopeXdr);

    const updated = await prisma.multisigTransaction.update({
      where: { id: transactionId },
      data: {
        currentSignatures: newSignatureCount,
        status: updatedStatus,
        envelopeXdr: mergedEnvelope,
      },
      include: { signatures: true },
    });

    logger.info(
      `Added signature from ${signerPublicKey} to transaction ${transactionId} ` +
      `(${newSignatureCount}/${multisigTx.threshold})`
    );

    // Notify about the new signature
    await this.notifySignatureAdded(transactionId, signerPublicKey, requiredSigners);

    // If threshold is reached, attempt automatic submission
    if (updatedStatus === MultisigStatus.READY) {
      await this.notifyThresholdReached(transactionId, requiredSigners);
      await this.attemptSubmission(transactionId);
    }

    return this.formatTransactionDetails(updated);
  }

  /**
   * Get a multisig transaction by ID
   */
  async getTransaction(transactionId: string): Promise<MultisigTransactionDetails | null> {
    const multisigTx = await prisma.multisigTransaction.findUnique({
      where: { id: transactionId },
      include: { signatures: true },
    });

    if (!multisigTx) {
      return null;
    }

    return this.formatTransactionDetails(multisigTx);
  }

  /**
   * Get multisig transactions for a signer
   */
  async getTransactionsForSigner(
    signerPublicKey: string,
    status?: MultisigStatus
  ): Promise<MultisigTransactionDetails[]> {
    const transactions = await prisma.multisigTransaction.findMany({
      where: {
        requiredSigners: {
          array_contains: signerPublicKey,
        },
        ...(status && { status }),
      },
      include: { signatures: true },
      orderBy: { createdAt: 'desc' },
    });

    return transactions.map(tx => this.formatTransactionDetails(tx));
  }

  /**
   * Get pending transactions that need a signature from a specific signer
   */
  async getPendingForSigner(signerPublicKey: string): Promise<MultisigTransactionDetails[]> {
    const transactions = await prisma.multisigTransaction.findMany({
      where: {
        requiredSigners: {
          array_contains: signerPublicKey,
        },
        status: {
          in: [MultisigStatus.PENDING, MultisigStatus.PARTIALLY_SIGNED],
        },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: { signatures: true },
      orderBy: { createdAt: 'desc' },
    });

    // Filter out transactions where the signer has already signed
    return transactions
      .filter(tx => !tx.signatures.some(sig => sig.signerPublicKey === signerPublicKey))
      .map(tx => this.formatTransactionDetails(tx));
  }

  /**
   * Manually submit a transaction that has reached threshold
   */
  async submitTransaction(transactionId: string): Promise<MultisigTransactionDetails> {
    const multisigTx = await prisma.multisigTransaction.findUnique({
      where: { id: transactionId },
      include: { signatures: true },
    });

    if (!multisigTx) {
      throw new Error('Multisig transaction not found');
    }

    if (multisigTx.status !== MultisigStatus.READY) {
      throw new Error(`Cannot submit: transaction is ${multisigTx.status}`);
    }

    return await this.attemptSubmission(transactionId);
  }

  /**
   * Attempt to submit a transaction to the Stellar network
   */
  private async attemptSubmission(transactionId: string): Promise<MultisigTransactionDetails> {
    const multisigTx = await prisma.multisigTransaction.findUnique({
      where: { id: transactionId },
      include: { signatures: true },
    });

    if (!multisigTx) {
      throw new Error('Multisig transaction not found');
    }

    try {
      // Create Stellar server instance
      const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');

      // Parse the transaction
      const transaction = new StellarSdk.TransactionBuilder.fromXDR(
        multisigTx.envelopeXdr,
        StellarSdk.Networks.TESTNET
      ) as StellarSdk.Transaction;

      // Submit to Stellar network
      const result = await server.submitTransaction(transaction);

      // Update transaction as submitted
      const updated = await prisma.multisigTransaction.update({
        where: { id: transactionId },
        data: {
          status: MultisigStatus.SUBMITTED,
          submittedAt: new Date(),
          stellarTxId: result.hash,
        },
        include: { signatures: true },
      });

      logger.info(`Successfully submitted transaction ${transactionId} to Stellar network: ${result.hash}`);

      // Notify all signers about successful submission
      const requiredSigners = multisigTx.requiredSigners as string[];
      await this.notifySubmitted(transactionId, result.hash, requiredSigners);

      return this.formatTransactionDetails(updated);
    } catch (error: any) {
      logger.error(`Failed to submit transaction ${transactionId}:`, error);

      // Update transaction as failed
      const updated = await prisma.multisigTransaction.update({
        where: { id: transactionId },
        data: {
          status: MultisigStatus.FAILED,
          metadata: {
            ...(multisigTx.metadata as object || {}),
            error: error.message,
            errorDetails: error.response?.data,
          },
        },
        include: { signatures: true },
      });

      // Notify all signers about failure
      const requiredSigners = multisigTx.requiredSigners as string[];
      await this.notifyFailed(transactionId, error.message, requiredSigners);

      throw new Error(`Failed to submit transaction: ${error.message}`);
    }
  }

  /**
   * Mark a transaction as expired
   */
  private async markAsExpired(transactionId: string): Promise<void> {
    await prisma.multisigTransaction.update({
      where: { id: transactionId },
      data: { status: MultisigStatus.EXPIRED },
    });

    logger.info(`Marked transaction ${transactionId} as expired`);
  }

  /**
   * Extract signature from a signed transaction for a specific signer
   */
  private extractSignature(transaction: StellarSdk.Transaction, signerPublicKey: string): string | null {
    const signatures = transaction.signatures;
    
    for (const decoratedSignature of signatures) {
      const hint = decoratedSignature.hint();
      const signature = decoratedSignature.signature();
      
      // Try to match the signature to the signer
      // This is a simplified approach - in production, you'd want more robust verification
      try {
        const keypair = StellarSdk.Keypair.fromPublicKey(signerPublicKey);
        const publicKeyBuffer = keypair.rawPublicKey();
        const hintFromPublicKey = publicKeyBuffer.slice(-4);
        
        if (Buffer.compare(hint, hintFromPublicKey) === 0) {
          return signature.toString('base64');
        }
      } catch (error) {
        continue;
      }
    }
    
    return null;
  }

  /**
   * Merge signatures from multiple signed envelopes
   */
  private async mergeSignatures(baseEnvelopeXdr: string, newEnvelopeXdr: string): Promise<string> {
    const baseTransaction = new StellarSdk.TransactionBuilder.fromXDR(
      baseEnvelopeXdr,
      StellarSdk.Networks.TESTNET
    ) as StellarSdk.Transaction;

    const newTransaction = new StellarSdk.TransactionBuilder.fromXDR(
      newEnvelopeXdr,
      StellarSdk.Networks.TESTNET
    ) as StellarSdk.Transaction;

    // Add all signatures from the new transaction to the base transaction
    for (const signature of newTransaction.signatures) {
      // Check if this signature already exists
      const exists = baseTransaction.signatures.some(
        existingSig => Buffer.compare(existingSig.signature(), signature.signature()) === 0
      );
      
      if (!exists) {
        baseTransaction.signatures.push(signature);
      }
    }

    return baseTransaction.toEnvelope().toXDR('base64');
  }

  /**
   * Send notifications to required signers
   */
  private async notifyRequiredSigners(transactionId: string, signers: string[]): Promise<void> {
    const notifications = signers.map(signer => ({
      multisigTransactionId: transactionId,
      recipientPublicKey: signer,
      type: 'SIGNATURE_REQUIRED',
      message: 'Your signature is required for a multisig transaction',
    }));

    await prisma.multisigNotification.createMany({
      data: notifications,
    });

    logger.info(`Sent signature required notifications for transaction ${transactionId}`);
  }

  /**
   * Notify about a new signature
   */
  private async notifySignatureAdded(
    transactionId: string,
    signerPublicKey: string,
    allSigners: string[]
  ): Promise<void> {
    const notifications = allSigners
      .filter(signer => signer !== signerPublicKey)
      .map(signer => ({
        multisigTransactionId: transactionId,
        recipientPublicKey: signer,
        type: 'SIGNATURE_ADDED',
        message: `${signerPublicKey} has signed the transaction`,
      }));

    if (notifications.length > 0) {
      await prisma.multisigNotification.createMany({
        data: notifications,
      });
    }
  }

  /**
   * Notify when threshold is reached
   */
  private async notifyThresholdReached(transactionId: string, signers: string[]): Promise<void> {
    const notifications = signers.map(signer => ({
      multisigTransactionId: transactionId,
      recipientPublicKey: signer,
      type: 'THRESHOLD_REACHED',
      message: 'Transaction has reached the required signature threshold',
    }));

    await prisma.multisigNotification.createMany({
      data: notifications,
    });

    logger.info(`Sent threshold reached notifications for transaction ${transactionId}`);
  }

  /**
   * Notify about successful submission
   */
  private async notifySubmitted(
    transactionId: string,
    stellarTxId: string,
    signers: string[]
  ): Promise<void> {
    const notifications = signers.map(signer => ({
      multisigTransactionId: transactionId,
      recipientPublicKey: signer,
      type: 'SUBMITTED',
      message: `Transaction successfully submitted to Stellar network: ${stellarTxId}`,
    }));

    await prisma.multisigNotification.createMany({
      data: notifications,
    });
  }

  /**
   * Notify about submission failure
   */
  private async notifyFailed(
    transactionId: string,
    errorMessage: string,
    signers: string[]
  ): Promise<void> {
    const notifications = signers.map(signer => ({
      multisigTransactionId: transactionId,
      recipientPublicKey: signer,
      type: 'FAILED',
      message: `Transaction submission failed: ${errorMessage}`,
    }));

    await prisma.multisigNotification.createMany({
      data: notifications,
    });
  }

  /**
   * Format transaction details for API response
   */
  private formatTransactionDetails(tx: any): MultisigTransactionDetails {
    return {
      id: tx.id,
      hash: tx.hash,
      envelopeXdr: tx.envelopeXdr,
      creatorPublicKey: tx.creatorPublicKey,
      requiredSigners: tx.requiredSigners as string[],
      threshold: tx.threshold,
      currentSignatures: tx.currentSignatures,
      status: tx.status,
      signatures: tx.signatures.map((sig: any) => ({
        signerPublicKey: sig.signerPublicKey,
        signedAt: sig.signedAt,
      })),
      memo: tx.memo,
      expiresAt: tx.expiresAt,
      submittedAt: tx.submittedAt,
      stellarTxId: tx.stellarTxId,
      metadata: tx.metadata as Record<string, any>,
      createdAt: tx.createdAt,
      updatedAt: tx.updatedAt,
    };
  }

  /**
   * Get notifications for a user
   */
  async getNotifications(publicKey: string, unreadOnly: boolean = false): Promise<any[]> {
    return await prisma.multisigNotification.findMany({
      where: {
        recipientPublicKey: publicKey,
        ...(unreadOnly && { readAt: null }),
      },
      include: {
        multisigTransaction: {
          select: {
            id: true,
            hash: true,
            status: true,
            threshold: true,
            currentSignatures: true,
          },
        },
      },
      orderBy: { sentAt: 'desc' },
    });
  }

  /**
   * Mark notifications as read
   */
  async markNotificationsAsRead(notificationIds: string[]): Promise<void> {
    await prisma.multisigNotification.updateMany({
      where: {
        id: { in: notificationIds },
      },
      data: {
        readAt: new Date(),
      },
    });
  }
}

export default new MultisigService();
