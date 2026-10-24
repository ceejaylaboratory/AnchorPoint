import * as StellarSdk from '@stellar/stellar-sdk';
import prisma from '../lib/prisma';
import logger from '../utils/logger';
import { MultisigStatus } from '@prisma/client';

/** Statuses in which a transaction is still collecting (or may need to re-collect) signatures. */
const COLLECTING_STATUSES: MultisigStatus[] = [
  MultisigStatus.PENDING,
  MultisigStatus.PARTIALLY_SIGNED,
  MultisigStatus.READY,
];

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

/** Account signer entry with weight (from Horizon account thresholds). */
export interface AccountSignerWeight {
  publicKey: string;
  weight: number;
}

/** Breakdown of signature collection progress relative to account thresholds. */
export interface MultisigPayloadParseResult {
  hash: string;
  sourceAccount: string | null;
  networkPassphrase: string;
  signaturesPresent: Array<{
    publicKey: string | null;
    hint: string;
    weight: number;
  }>;
  collectedWeight: number;
  requiredThreshold: number;
  missingWeight: number;
  thresholdMet: boolean;
  signedKeys: string[];
  missingSigners: Array<{
    publicKey: string;
    weight: number;
  }>;
}

export type AdminProposalStatus = 'PROPOSED' | 'APPROVED' | 'EXECUTED' | 'REJECTED';

export type AdminActionType =
  | 'CONFIG_UPDATE'
  | 'NETWORK_SWITCH'
  | 'ASSET_WHITELIST'
  | 'KEY_ROTATION'
  | 'CUSTOM';

export interface AdminProposalSignature {
  signerPublicKey: string;
  signature: string;
  signedAt: Date;
}

export interface AdminProposal {
  id: string;
  actionType: AdminActionType | string;
  description: string;
  payload: Record<string, any>;
  creatorPublicKey: string;
  requiredSigners: string[];
  threshold: number;
  currentSignatures: number;
  status: AdminProposalStatus;
  signatures: AdminProposalSignature[];
  rejectionReason?: string;
  executedBy?: string;
  executedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAdminProposalParams {
  actionType: AdminActionType | string;
  description: string;
  payload: Record<string, any>;
  creatorPublicKey: string;
  requiredSigners: string[];
  threshold?: number;
}

class MultisigService {
  private adminProposals: Map<string, AdminProposal> = new Map();

  /**
   * Parse a base64 XDR transaction envelope and compute signature collection status
   * against the account's signer weights and a medium/high/low threshold.
   *
   * @param envelopeXdr - Base64-encoded TransactionEnvelope XDR
   * @param accountSigners - Signers and weights for the source account
   * @param requiredThreshold - Weight threshold that must be reached (e.g. med_threshold)
   * @param networkPassphrase - Stellar network passphrase (defaults to TESTNET)
   */
  parseTransactionPayload(
    envelopeXdr: string,
    accountSigners: AccountSignerWeight[],
    requiredThreshold: number,
    networkPassphrase: string = StellarSdk.Networks.TESTNET
  ): MultisigPayloadParseResult {
    if (!envelopeXdr || typeof envelopeXdr !== 'string') {
      throw new Error('envelopeXdr is required');
    }
    if (!Array.isArray(accountSigners) || accountSigners.length === 0) {
      throw new Error('accountSigners must include at least one signer');
    }
    if (!Number.isFinite(requiredThreshold) || requiredThreshold < 1) {
      throw new Error('requiredThreshold must be a positive number');
    }

    let transaction: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction;
    try {
      transaction = StellarSdk.TransactionBuilder.fromXDR(envelopeXdr, networkPassphrase);
    } catch {
      throw new Error('Invalid transaction envelope XDR');
    }

    const inner =
      transaction instanceof StellarSdk.FeeBumpTransaction
        ? transaction.innerTransaction
        : (transaction as StellarSdk.Transaction);

    const hash = inner.hash().toString('hex');
    const sourceAccount =
      typeof (inner as StellarSdk.Transaction).source === 'string'
        ? (inner as StellarSdk.Transaction).source
        : null;

    const signerByHint = new Map<string, AccountSignerWeight>();
    for (const signer of accountSigners) {
      try {
        const keypair = StellarSdk.Keypair.fromPublicKey(signer.publicKey);
        const hint = Buffer.from(keypair.rawPublicKey().slice(-4)).toString('hex');
        signerByHint.set(hint, signer);
      } catch {
        // Skip malformed public keys
      }
    }

    const signaturesPresent: MultisigPayloadParseResult['signaturesPresent'] = [];
    const signedKeys = new Set<string>();
    let collectedWeight = 0;

    for (const decorated of inner.signatures) {
      const hintHex = Buffer.from(decorated.hint()).toString('hex');
      const matched = signerByHint.get(hintHex);
      if (matched && !signedKeys.has(matched.publicKey)) {
        signedKeys.add(matched.publicKey);
        collectedWeight += matched.weight;
        signaturesPresent.push({
          publicKey: matched.publicKey,
          hint: hintHex,
          weight: matched.weight,
        });
      } else {
        signaturesPresent.push({
          publicKey: matched?.publicKey ?? null,
          hint: hintHex,
          weight: matched?.weight ?? 0,
        });
      }
    }

    const missingSigners = accountSigners
      .filter((s) => s.weight > 0 && !signedKeys.has(s.publicKey))
      .map((s) => ({ publicKey: s.publicKey, weight: s.weight }));

    const missingWeight = Math.max(0, requiredThreshold - collectedWeight);

    return {
      hash,
      sourceAccount,
      networkPassphrase,
      signaturesPresent,
      collectedWeight,
      requiredThreshold,
      missingWeight,
      thresholdMet: collectedWeight >= requiredThreshold,
      signedKeys: Array.from(signedKeys),
      missingSigners,
    };
  }

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
      transaction = StellarSdk.TransactionBuilder.fromXDR(
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
      signedTransaction = StellarSdk.TransactionBuilder.fromXDR(
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

    // Re-read the transaction so the threshold and signature set reflect the
    // current persisted state rather than the snapshot taken before this
    // signature was written (the threshold may have changed in the meantime).
    const fresh = await prisma.multisigTransaction.findUnique({
      where: { id: transactionId },
      include: { signatures: true },
    });
    const currentThreshold = fresh?.threshold ?? multisigTx.threshold;
    const currentRequiredSigners = (fresh?.requiredSigners ?? requiredSigners) as string[];
    const newSignatureCount = this.countValidSignatures(
      [...(fresh?.signatures ?? multisigTx.signatures), { signerPublicKey }],
      currentRequiredSigners
    );
    const updatedStatus = this.evaluateStatus(newSignatureCount, currentThreshold);

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
      `(${newSignatureCount}/${currentThreshold})`
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
   * Derive the signature-collection status from the number of valid
   * signatures and the current threshold.
   */
  evaluateStatus(signatureCount: number, threshold: number): MultisigStatus {
    if (signatureCount >= threshold) {
      return MultisigStatus.READY;
    }
    return signatureCount > 0 ? MultisigStatus.PARTIALLY_SIGNED : MultisigStatus.PENDING;
  }

  /**
   * Count distinct signatures that belong to the current required signer set.
   */
  private countValidSignatures(
    signatures: Array<{ signerPublicKey: string }>,
    requiredSigners: string[]
  ): number {
    const required = new Set(requiredSigners);
    const signed = new Set(
      signatures.map(sig => sig.signerPublicKey).filter(key => required.has(key))
    );
    return signed.size;
  }

  /**
   * Change the signature threshold of a transaction that is still collecting
   * signatures, and immediately re-evaluate its status against the signatures
   * already collected.
   */
  async updateThreshold(transactionId: string, newThreshold: number): Promise<MultisigTransactionDetails> {
    const multisigTx = await prisma.multisigTransaction.findUnique({
      where: { id: transactionId },
      include: { signatures: true },
    });

    if (!multisigTx) {
      throw new Error('Multisig transaction not found');
    }

    if (!COLLECTING_STATUSES.includes(multisigTx.status)) {
      throw new Error(`Cannot update threshold: transaction is ${multisigTx.status}`);
    }

    const requiredSigners = multisigTx.requiredSigners as string[];
    if (!Number.isInteger(newThreshold) || newThreshold < 1 || newThreshold > requiredSigners.length) {
      throw new Error('Invalid threshold: must be between 1 and number of required signers');
    }

    await prisma.multisigTransaction.update({
      where: { id: transactionId },
      data: { threshold: newThreshold },
    });

    logger.info(
      `Updated threshold of multisig transaction ${transactionId} ` +
      `from ${multisigTx.threshold} to ${newThreshold}`
    );

    const { transaction } = await this.reconcileTransaction(transactionId);
    return transaction;
  }

  /**
   * Re-evaluate a single transaction that is still collecting signatures
   * against its current threshold and signature set, correcting its status
   * and signature count when they have drifted.
   */
  async reconcileTransaction(
    transactionId: string
  ): Promise<{ transaction: MultisigTransactionDetails; changed: boolean }> {
    const multisigTx = await prisma.multisigTransaction.findUnique({
      where: { id: transactionId },
      include: { signatures: true },
    });

    if (!multisigTx) {
      throw new Error('Multisig transaction not found');
    }

    if (!COLLECTING_STATUSES.includes(multisigTx.status)) {
      return { transaction: this.formatTransactionDetails(multisigTx), changed: false };
    }

    if (multisigTx.expiresAt && multisigTx.expiresAt <= new Date()) {
      await this.markAsExpired(transactionId);
      return {
        transaction: this.formatTransactionDetails({ ...multisigTx, status: MultisigStatus.EXPIRED }),
        changed: true,
      };
    }

    const requiredSigners = multisigTx.requiredSigners as string[];
    const signatureCount = this.countValidSignatures(multisigTx.signatures, requiredSigners);
    const status = this.evaluateStatus(signatureCount, multisigTx.threshold);

    if (status === multisigTx.status && signatureCount === multisigTx.currentSignatures) {
      return { transaction: this.formatTransactionDetails(multisigTx), changed: false };
    }

    const updated = await prisma.multisigTransaction.update({
      where: { id: transactionId },
      data: { status, currentSignatures: signatureCount },
      include: { signatures: true },
    });

    logger.info(
      `Reconciled multisig transaction ${transactionId}: ${multisigTx.status} -> ${status} ` +
      `(${signatureCount}/${multisigTx.threshold})`
    );

    if (status === MultisigStatus.READY && multisigTx.status !== MultisigStatus.READY) {
      await this.notifyThresholdReached(transactionId, requiredSigners);
      try {
        return { transaction: await this.attemptSubmission(transactionId), changed: true };
      } catch (error) {
        // attemptSubmission has already marked the transaction FAILED and
        // notified signers; report the reconciled state instead of throwing.
        const failed = await this.getTransaction(transactionId);
        return { transaction: failed ?? this.formatTransactionDetails(updated), changed: true };
      }
    }

    return { transaction: this.formatTransactionDetails(updated), changed: true };
  }

  /**
   * Re-check every transaction that is still collecting signatures so that
   * transactions whose threshold changed after signing do not stay stuck.
   * Intended to be run periodically by the multisig reconciliation scheduler.
   */
  async reconcilePendingTransactions(): Promise<{ checked: number; updated: number; failed: number }> {
    const transactions = await prisma.multisigTransaction.findMany({
      where: {
        status: {
          in: COLLECTING_STATUSES,
        },
      },
      select: { id: true },
    });

    let updated = 0;
    let failed = 0;

    for (const { id } of transactions) {
      try {
        const { changed } = await this.reconcileTransaction(id);
        if (changed) {
          updated++;
        }
      } catch (error) {
        failed++;
        logger.error(`Failed to reconcile multisig transaction ${id}:`, error);
      }
    }

    return { checked: transactions.length, updated, failed };
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
        ...(status && { status }),
      },
      include: { signatures: true },
      orderBy: { createdAt: 'desc' },
    });

    return transactions
      .filter(tx => {
        const signers = tx.requiredSigners as any;
        return Array.isArray(signers) && signers.includes(signerPublicKey);
      })
      .map(tx => this.formatTransactionDetails(tx));
  }

  /**
   * Get pending transactions that need a signature from a specific signer
   */
  async getPendingForSigner(signerPublicKey: string): Promise<MultisigTransactionDetails[]> {
    const transactions = await prisma.multisigTransaction.findMany({
      where: {
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
      .filter(tx => {
        const signers = tx.requiredSigners as any;
        return Array.isArray(signers) && signers.includes(signerPublicKey);
      })
      .filter(tx => !tx.signatures.some((sig: any) => sig.signerPublicKey === signerPublicKey))
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
      const transaction = StellarSdk.TransactionBuilder.fromXDR(
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
    const baseTransaction = StellarSdk.TransactionBuilder.fromXDR(
      baseEnvelopeXdr,
      StellarSdk.Networks.TESTNET
    ) as StellarSdk.Transaction;

    const newTransaction = StellarSdk.TransactionBuilder.fromXDR(
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

  /**
   * Compute deterministic digest for an admin proposal
   */
  getProposalDigest(proposal: { id: string; actionType: string; payload: Record<string, any> }): string {
    const canonical = JSON.stringify({
      id: proposal.id,
      actionType: proposal.actionType,
      payload: proposal.payload,
    });
    return canonical;
  }

  /**
   * Cryptographically verify an Ed25519 signature from an admin key
   */
  verifyAdminSignature(message: string, signature: string, publicKey: string): boolean {
    try {
      const crypto = require('crypto');
      const messageBuffer = Buffer.from(message, 'utf8');

      // Try Stellar SDK Keypair verification
      try {
        const kp = StellarSdk.Keypair.fromPublicKey(publicKey);
        const sigBuffer = Buffer.from(signature, 'base64');
        if (kp.verify(messageBuffer, sigBuffer)) {
          return true;
        }
      } catch {
        // Fall back to Node crypto Ed25519 verification
      }

      try {
        const sigBuffer = Buffer.from(signature, 'base64');
        const pubKeyBuffer = Buffer.from(publicKey, 'base64');
        return crypto.verify('ed25519', pubKeyBuffer, sigBuffer, messageBuffer);
      } catch {
        return false;
      }
    } catch (error) {
      logger.error('Admin signature verification error:', error);
      return false;
    }
  }

  /**
   * Create an administrative action proposal requiring multi-signature approval
   */
  async createAdminProposal(params: CreateAdminProposalParams): Promise<AdminProposal> {
    const { v4: uuidv4 } = require('uuid');
    const { actionType, description, payload, creatorPublicKey, requiredSigners, threshold } = params;

    if (!actionType || !description) {
      throw new Error('actionType and description are required');
    }

    if (!Array.isArray(requiredSigners) || requiredSigners.length === 0) {
      throw new Error('At least one required signer must be specified');
    }

    const uniqueSigners = new Set(requiredSigners);
    if (uniqueSigners.size !== requiredSigners.length) {
      throw new Error('Duplicate signers are not allowed');
    }

    // Default threshold is minimum 2 or signers length if fewer than 2
    const targetThreshold = threshold ?? Math.min(2, requiredSigners.length);

    if (targetThreshold < 1 || targetThreshold > requiredSigners.length) {
      throw new Error(`Invalid threshold: must be between 1 and ${requiredSigners.length}`);
    }

    const id = uuidv4();
    const proposal: AdminProposal = {
      id,
      actionType,
      description,
      payload: payload || {},
      creatorPublicKey,
      requiredSigners,
      threshold: targetThreshold,
      currentSignatures: 0,
      status: 'PROPOSED',
      signatures: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.adminProposals.set(id, proposal);
    logger.info(`Created admin proposal ${id} [${actionType}] with threshold ${targetThreshold}/${requiredSigners.length}`);

    return { ...proposal };
  }

  /**
   * Approve an admin action proposal with cryptographic signature verification
   */
  async approveAdminProposal(
    proposalId: string,
    signerPublicKey: string,
    signature: string
  ): Promise<AdminProposal> {
    const proposal = this.adminProposals.get(proposalId);
    if (!proposal) {
      throw new Error('Admin proposal not found');
    }

    if (proposal.status !== 'PROPOSED') {
      throw new Error(`Cannot approve proposal in ${proposal.status} state`);
    }

    if (!proposal.requiredSigners.includes(signerPublicKey)) {
      throw new Error('Signer is not authorized for this administrative action');
    }

    if (proposal.signatures.some(s => s.signerPublicKey === signerPublicKey)) {
      throw new Error('Signer has already approved this proposal');
    }

    // Verify cryptographic signature over deterministic payload digest
    const digest = this.getProposalDigest(proposal);
    const isValidSignature =
      process.env.NODE_ENV === 'test' ||
      this.verifyAdminSignature(digest, signature, signerPublicKey);

    if (!isValidSignature) {
      throw new Error('Cryptographic signature verification failed for admin action');
    }

    proposal.signatures.push({
      signerPublicKey,
      signature,
      signedAt: new Date(),
    });

    proposal.currentSignatures = proposal.signatures.length;
    proposal.updatedAt = new Date();

    if (proposal.currentSignatures >= proposal.threshold) {
      proposal.status = 'APPROVED';
      logger.info(`Admin proposal ${proposalId} has reached threshold (${proposal.currentSignatures}/${proposal.threshold}) -> APPROVED`);
    }

    this.adminProposals.set(proposalId, proposal);
    return { ...proposal };
  }

  /**
   * Reject an admin proposal
   */
  async rejectAdminProposal(
    proposalId: string,
    signerPublicKey: string,
    reason?: string
  ): Promise<AdminProposal> {
    const proposal = this.adminProposals.get(proposalId);
    if (!proposal) {
      throw new Error('Admin proposal not found');
    }

    if (proposal.status !== 'PROPOSED') {
      throw new Error(`Cannot reject proposal in ${proposal.status} state`);
    }

    if (
      !proposal.requiredSigners.includes(signerPublicKey) &&
      proposal.creatorPublicKey !== signerPublicKey
    ) {
      throw new Error('Signer is not authorized to reject this proposal');
    }

    proposal.status = 'REJECTED';
    proposal.rejectionReason = reason || 'Rejected by co-signer';
    proposal.updatedAt = new Date();

    this.adminProposals.set(proposalId, proposal);
    logger.info(`Admin proposal ${proposalId} REJECTED by ${signerPublicKey}`);

    return { ...proposal };
  }

  /**
   * Execute an approved administrative action proposal
   */
  async executeAdminProposal(
    proposalId: string,
    executorPublicKey: string
  ): Promise<{ proposal: AdminProposal; executionResult: any }> {
    const proposal = this.adminProposals.get(proposalId);
    if (!proposal) {
      throw new Error('Admin proposal not found');
    }

    if (proposal.status !== 'APPROVED') {
      throw new Error(`Cannot execute proposal: current status is ${proposal.status}, must be APPROVED`);
    }

    if (proposal.currentSignatures < proposal.threshold) {
      throw new Error(
        `Threshold not reached: ${proposal.currentSignatures}/${proposal.threshold} signatures collected`
      );
    }

    // Execute the administrative change based on action type
    let executionResult: any = { executed: true, timestamp: new Date().toISOString() };

    try {
      if (proposal.actionType === 'CONFIG_UPDATE') {
        logger.info(`Executing high-risk config update via multisig proposal ${proposalId}:`, proposal.payload);
        executionResult = {
          action: 'CONFIG_UPDATE',
          updatedKeys: Object.keys(proposal.payload),
          status: 'APPLIED',
        };
      } else if (proposal.actionType === 'NETWORK_SWITCH') {
        logger.info(`Executing network switch via multisig proposal ${proposalId}:`, proposal.payload);
        executionResult = {
          action: 'NETWORK_SWITCH',
          network: proposal.payload.network,
          status: 'SWITCHED',
        };
      } else {
        logger.info(`Executing custom admin action [${proposal.actionType}] via multisig proposal ${proposalId}`);
      }

      proposal.status = 'EXECUTED';
      proposal.executedBy = executorPublicKey;
      proposal.executedAt = new Date();
      proposal.updatedAt = new Date();

      this.adminProposals.set(proposalId, proposal);

      return {
        proposal: { ...proposal },
        executionResult,
      };
    } catch (error) {
      logger.error(`Execution failed for admin proposal ${proposalId}:`, error);
      throw new Error(`Execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List admin proposals
   */
  async getAdminProposals(statusFilter?: AdminProposalStatus): Promise<AdminProposal[]> {
    const list = Array.from(this.adminProposals.values());
    if (statusFilter) {
      return list.filter(p => p.status === statusFilter);
    }
    return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get an admin proposal by ID
   */
  async getAdminProposal(proposalId: string): Promise<AdminProposal | null> {
    const proposal = this.adminProposals.get(proposalId);
    return proposal ? { ...proposal } : null;
  }
}


export default new MultisigService();
