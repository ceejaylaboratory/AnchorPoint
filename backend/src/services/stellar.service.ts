import { Horizon, rpc, TransactionBuilder, Account, Networks, Memo, Operation, Keypair, Transaction, FeeBumpTransaction, Asset, Claimant, xdr } from '@stellar/stellar-sdk';
import { NetworkType, NETWORKS } from '../config/networks';
import { config } from '../config/env';
import { SignerInfo, SignatureInfo } from './auth.service';
import configService from './config.service';
import logger from '../utils/logger';
import prisma from '../lib/prisma';

export interface AccountSigners {
  signers: Array<{
    key: string;
    weight: number;
    type: string;
  }>;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
}

export class StellarService {
  private static instance: StellarService;
  private currentNetwork: NetworkType;
  private server: Horizon.Server;
  private networkPassphrase: string;
  private rpcUrls: string[];

  // Whitelisted operations for submission
  private readonly ALLOWED_OPERATIONS = [
    'payment',
    'changeTrust',
    'manageData',
    'setOptions',
    'manageBuyOffer',
    'manageSellOffer',
    'createAccount',
  ];

  private constructor() {
    // Initialize network from environment configuration
    const networkFromEnv = config.STELLAR_NETWORK.toUpperCase();
    this.currentNetwork = NetworkType[networkFromEnv as keyof typeof NetworkType] || NetworkType.TESTNET;
    this.server = new Horizon.Server(config.STELLAR_HORIZON_URL);
    this.networkPassphrase = this.getPassphrase();
    this.rpcUrls = this.getRpcUrls();
  }

  private getRpcUrls(): string[] {
    const rpcUrls = config.STELLAR_RPC_URLS;
    if (rpcUrls) {
      return rpcUrls.split(',').map((url) => url.trim()).filter((url) => url.length > 0);
    }
    const networkConfig = NETWORKS[this.currentNetwork];
    return [networkConfig.sorobanRpcUrl];
  }

  private static readonly RETRYABLE_HORIZON_STATUS_CODES = [429, 502, 503, 504];

  /**
   * Wraps a Horizon request with retries (exponential backoff + jitter) for
   * transient failures (rate limiting, gateway/service errors).
   */
  private async retryHorizonRequest<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        const statusCode = error?.response?.status;
        if (attempt === maxRetries || !StellarService.RETRYABLE_HORIZON_STATUS_CODES.includes(statusCode)) {
          throw error;
        }
        const backoffMs = 2 ** attempt * 500;
        const jitterMs = Math.random() * 250;
        logger.warn(
          `Horizon request failed with status ${statusCode}, retrying (attempt ${attempt + 1}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs + jitterMs));
      }
    }
    throw lastError;
  }

  private async executeRpcWithFailover<T>(method: string, ...args: any[]): Promise<T> {
    const errors: Error[] = [];
    for (let i = 0; i < this.rpcUrls.length; i++) {
      const index = i;
      const rpcServer = new rpc.Server(this.rpcUrls[index]);
      try {
        const rpcMethod = (rpcServer as any)[method];
        if (typeof rpcMethod !== 'function') {
          throw new Error(`RPC method '${method}' not found on rpc.Server`);
        }
        const result = await rpcMethod.apply(rpcServer, args);
        if (i > 0) {
          logger.warn(`RPC failover: request succeeded on fallback server at index ${index}`);
        }
        return result;
      } catch (error: any) {
        errors.push(error);
        const statusCode = error?.response?.status;
        if (statusCode && statusCode >= 500) {
          logger.warn(`RPC server at index ${index} returned ${statusCode}, failing over to next server`);
          continue;
        }
        throw error;
      }
    }
    throw errors[errors.length - 1] || new Error('All RPC servers failed');
  }

  public static getInstance(): StellarService {
    if (!StellarService.instance) {
      StellarService.instance = new StellarService();
    }
    return StellarService.instance;
  }

  public setNetwork(network: NetworkType): void {
    if (!NETWORKS[network]) {
      throw new Error(`Invalid network type: ${network}`);
    }
    this.currentNetwork = network;
    this.server = this.getHorizonServer();
    this.networkPassphrase = this.getPassphrase();
    this.rpcUrls = this.getRpcUrls();
  }

  public getNetwork(): NetworkType {
    return this.currentNetwork;
  }

  public getHorizonServer(network: NetworkType = this.currentNetwork): Horizon.Server {
    const config = NETWORKS[network];
    return new Horizon.Server(config.horizonUrl);
  }

  public getSorobanRpc(network: NetworkType = this.currentNetwork): rpc.Server {
    const config = NETWORKS[network];
    return new rpc.Server(config.sorobanRpcUrl);
  }

  public async getSorobanRpcWithFailover(network: NetworkType = this.currentNetwork): Promise<rpc.Server> {
    if (this.rpcUrls.length <= 1) {
      return this.getSorobanRpc(network);
    }
    const primaryUrl = this.rpcUrls[0];
    const fallbackUrls = this.rpcUrls.slice(1);
    const allUrls = [primaryUrl, ...fallbackUrls];
    const primaryServer = new rpc.Server(primaryUrl);
    return new Proxy(primaryServer, {
      get(target: rpc.Server, prop: string, receiver: any) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function' && prop !== 'constructor') {
          return async (...args: any[]) => {
            const errors: Error[] = [];
            for (let i = 0; i < allUrls.length; i++) {
              const server = new rpc.Server(allUrls[i]);
              try {
                const method = Reflect.get(server, prop, receiver);
                if (typeof method === 'function') {
                  const result = await method.apply(server, args);
                  if (i > 0) {
                    logger.warn(`RPC failover: request succeeded on fallback server at index ${i}`);
                  }
                  return result;
                }
              } catch (error: any) {
                errors.push(error);
                const statusCode = error?.response?.status;
                if (statusCode && statusCode >= 500) {
                  logger.warn(`RPC server at index ${i} returned ${statusCode}, failing over to next server`);
                  continue;
                }
                throw error;
              }
            }
            throw errors[errors.length - 1] || new Error('All RPC servers failed');
          };
        }
        return value;
      },
    });
  }

  public getPassphrase(network: NetworkType = this.currentNetwork): string {
    return NETWORKS[network].passphrase;
  }

  /**
   * Fetch account signers and thresholds from Horizon
   */
  public async getAccountSigners(accountId: string): Promise<AccountSigners> {
    const server = this.getHorizonServer();
    const account = await this.retryHorizonRequest(() => server.loadAccount(accountId));

    return {
      signers: account.signers.map((signer: any) => ({
        key: signer.key,
        weight: signer.weight,
        type: signer.type
      })),
      thresholds: {
        low_threshold: account.thresholds.low_threshold,
        med_threshold: account.thresholds.med_threshold,
        high_threshold: account.thresholds.high_threshold
      }
    };
  }

  /**
   * Checks whether an account holds a trustline for the given asset.
   * Useful as a pre-flight check before submitting payout transactions.
   */
  public async hasTrustline(accountPublicKey: string, assetCode: string, assetIssuer: string): Promise<boolean> {
    const server = this.getHorizonServer();
    const account = await this.retryHorizonRequest(() => server.loadAccount(accountPublicKey));

    return account.balances.some((balance: any) =>
      balance.asset_code === assetCode && balance.asset_issuer === assetIssuer
    );
  }

  /**
   * Sends `amount` of `assetCode` to `recipientPublicKey`, falling back to a
   * Claimable Balance when the recipient's account does not hold a trustline
   * for the asset (e.g. newly created / unfunded accounts).
   *
   * Flow:
   *  1. Load the anchor's distribution account to get the sequence number.
   *  2. Check whether the recipient holds a trustline via `hasTrustline`.
   *  3a. Trustline present  → build a standard `Payment` operation.
   *  3b. Trustline absent   → build a `CreateClaimableBalance` operation so
   *      the recipient can claim the funds once they establish a trustline.
   *  4. Sign with `senderSecret`, submit to Horizon, and return the result.
   *  5. When `transactionId` is given and the fallback path was taken, persist
   *     the claimable balance ID on the transaction record.
   *
   * Returns an object with `hash` (transaction hash) and optionally
   * `claimableBalanceId` when the fallback path was taken.
   */
  public async sendPaymentWithClaimableFallback(options: {
    senderSecret: string;
    recipientPublicKey: string;
    assetCode: string;
    assetIssuer: string;
    amount: string;
    /** Anchor transaction ID to record the claimable balance ID against. */
    transactionId?: string;
  }): Promise<{ hash: string; claimableBalanceId?: string; usedClaimableBalance: boolean }> {
    const { senderSecret, recipientPublicKey, assetCode, assetIssuer, amount, transactionId } = options;

    const senderKeypair = Keypair.fromSecret(senderSecret);
    const server = this.getHorizonServer();
    const networkPassphrase = this.getPassphrase();

    const senderAccount = await this.retryHorizonRequest(() =>
      server.loadAccount(senderKeypair.publicKey()),
    );

    const asset = new Asset(assetCode, assetIssuer);

    // Check for trustline — determines which operation to use
    let recipientHasTrustline = false;
    try {
      recipientHasTrustline = await this.hasTrustline(recipientPublicKey, assetCode, assetIssuer);
    } catch (error: any) {
      // A 404 means the recipient account doesn't exist yet (unfunded), so it
      // can only receive funds as a claimable balance. Any other failure is a
      // Horizon/network problem and must not silently change the payment path.
      const notFound = error?.response?.status === 404 || error?.name === 'NotFoundError';
      if (!notFound) {
        throw error;
      }
      recipientHasTrustline = false;
    }

    let operation: ReturnType<typeof Operation.payment | typeof Operation.createClaimableBalance>;

    if (recipientHasTrustline) {
      // Standard payment path
      operation = Operation.payment({
        destination: recipientPublicKey,
        asset,
        amount,
      });
    } else {
      // Claimable balance fallback for unfunded / no-trustline accounts
      logger.info(`Recipient ${recipientPublicKey} has no trustline for ${assetCode}; creating claimable balance`);
      operation = Operation.createClaimableBalance({
        asset,
        amount,
        claimants: [new Claimant(recipientPublicKey)],
      });
    }

    const tx = new TransactionBuilder(senderAccount, {
      fee: config.STELLAR_BASE_FEE || '100',
      networkPassphrase,
    })
      .addOperation(operation as Parameters<TransactionBuilder['addOperation']>[0])
      .setTimeout(30)
      .build();

    tx.sign(senderKeypair);

    const response = await this.retryHorizonRequest(() => server.submitTransaction(tx));

    logger.info(`Payment submitted: ${response.hash}`, {
      recipient: recipientPublicKey,
      assetCode,
      amount,
      usedClaimableBalance: !recipientHasTrustline,
    });

    // Extract claimable balance ID from the transaction result when the
    // fallback path was used. The ID is embedded in the operation result XDR.
    let claimableBalanceId: string | undefined;
    if (!recipientHasTrustline) {
      try {
        const resultXdr = (response as any).result_xdr;
        if (resultXdr) {
          const result = xdr.TransactionResult.fromXDR(resultXdr, 'base64');
          const opResult = result.result().results()[0];
          const cbResult = opResult.tr().createClaimableBalanceResult();
          claimableBalanceId = cbResult.balanceId().toXDR('hex');
        }
      } catch (e) {
        logger.warn('Could not extract claimable balance ID from result XDR', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (transactionId && claimableBalanceId) {
      try {
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { claimableBalanceId, stellarTxId: response.hash },
        });
      } catch (e) {
        // The payment is already on-chain; don't fail the caller over bookkeeping.
        logger.error('Failed to record claimable balance ID on transaction', {
          transactionId,
          claimableBalanceId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      hash: response.hash,
      claimableBalanceId,
      usedClaimableBalance: !recipientHasTrustline,
    };
  }

  /**
   * Convert Stellar signers to our SignerInfo format
   */
  public convertToSignerInfo(accountSigners: AccountSigners): SignerInfo[] {
    return accountSigners.signers.map(signer => ({
      publicKey: signer.key,
      weight: signer.weight,
      signed: false
    }));
  }

  /**
   * Build a SEP-10 challenge transaction
   */
  public buildChallengeTransaction(
    serverAccountId: string,
    clientAccountId: string,
    challenge: string,
    domain: string,
    memo?: string
  ): string {
    const networkPassphrase = this.getPassphrase();
    const serverSecret = config.ANCHOR_SECRET_KEY || '';
    const serverKeypair = Keypair.fromSecret(serverSecret);

    // Verify the server account ID matches the secret key
    if (serverKeypair.publicKey() !== serverAccountId) {
      throw new Error('Server account ID does not match secret key');
    }

    // Create a simple account for the server (we don't need to load it for building)
    const serverAccount = new Account(serverAccountId, '1');

    const builder = new TransactionBuilder(serverAccount, {
      networkPassphrase,
      fee: '100'
    });

    // Add manage_data operation for the challenge
    builder.addOperation(
      Operation.manageData({
        name: `${domain} auth`,
        value: challenge,
        source: clientAccountId
      })
    );

    // Add memo if provided
    if (memo) {
      builder.addMemo(Memo.text(memo));
    }

    // Set timeout and build transaction
    const transaction = builder
      .setTimeout(300)
      .build();

    // Sign with server key
    transaction.sign(serverKeypair);

    return transaction.toXDR();
  }

  /**
   * Verify a SEP-10 challenge transaction
   */
  public async verifyChallengeTransaction(
    transactionXdr: string,
    serverAccountId: string,
    domain: string
  ): Promise<{
    valid: boolean;
    accountId?: string;
    signers?: string[];
    error?: string;
  }> {
    try {
      const networkPassphrase = this.getPassphrase();
      const transaction = TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);

      // Verify server signature
      const serverSecret = config.ANCHOR_SECRET_KEY || '';
      const serverKeypair = Keypair.fromSecret(serverSecret);

      if (!transaction.signatures.some((sig: any) =>
        serverKeypair.verify(transaction.hash(), sig.signature())
      )) {
        return { valid: false, error: 'Invalid server signature' };
      }

      // Extract client account from operations
      const manageDataOp = transaction.operations.find((op: any) =>
        op.type === 'manage_data' &&
        op.name === `${domain} auth`
      ) as any;

      if (!manageDataOp) {
        return { valid: false, error: 'Invalid challenge operation' };
      }

      const clientAccountId = manageDataOp.source;

      // Get account signers to verify signatures
      const accountSigners = await this.getAccountSigners(clientAccountId);
      const validSigners: string[] = [];

      // Verify each signature against account signers
      for (const signature of transaction.signatures) {
        for (const signer of accountSigners.signers) {
          try {
            const signerKeypair = Keypair.fromPublicKey(signer.key);
            if (signerKeypair.verify(transaction.hash(), signature.signature())) {
              validSigners.push(signer.key);
              break;
            }
          } catch (error) {
            // Invalid signature, continue
          }
        }
      }

      return {
        valid: validSigners.length > 0,
        accountId: clientAccountId,
        signers: validSigners
      };

    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Transaction verification failed'
      };
    }
  }

  /**
   * Get threshold requirements for different operation types
   */
  public getThresholdRequirements(accountSigners: AccountSigners): {
    low: number;
    medium: number;
    high: number;
  } {
    return {
      low: accountSigners.thresholds.low_threshold,
      medium: accountSigners.thresholds.med_threshold,
      high: accountSigners.thresholds.high_threshold
    };
  }

  /**
   * Validates and submits a pre-signed transaction XDR
   * @param xdr Base64 encoded transaction XDR
   * @returns Submission result
   */
  public async submitTransaction(xdr: string): Promise<any> {
    try {
      const passphrase = this.getPassphrase();
      const server = this.getHorizonServer();
      const tx = TransactionBuilder.fromXDR(xdr, passphrase);

      // Ensure it's not a fee-bump transaction itself
      if (tx instanceof FeeBumpTransaction) {
        throw new Error('Direct submission of fee-bump transactions is not allowed');
      }

      // Now tx is guaranteed to be a regular Transaction
      const transaction = tx as Transaction;

      // Validate operations against whitelist
      this.validateOperations(transaction);

      // Automated Fee Management: Wrap in a fee-bump transaction if backend is configured
      let finalTx: Transaction | FeeBumpTransaction = transaction;

      const feeBumpSecret = config.STELLAR_FEE_BUMP_SECRET;
      if (feeBumpSecret) {
        const feeBumpKeypair = Keypair.fromSecret(feeBumpSecret);
        logger.info(`Applying fee-bump for transaction from ${transaction.source}`);
        finalTx = TransactionBuilder.buildFeeBumpTransaction(
          feeBumpKeypair,
          config.STELLAR_BASE_FEE,
          transaction,
          passphrase
        );
      }

      const response = await this.retryHorizonRequest(() => server.submitTransaction(finalTx));
      logger.info(`Transaction submitted successfully: ${response.hash}`);
      return response;
    } catch (error: any) {
      const errorMessage = error.response?.data?.extras?.result_codes?.operations
        ? `Stellar Error: ${JSON.stringify(error.response.data.extras.result_codes)}`
        : error.message;

      logger.error('Stellar submission error:', errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * Validates that all operations in the transaction are whitelisted
   */
  private validateOperations(tx: Transaction): void {
    for (const op of tx.operations) {
      if (!this.ALLOWED_OPERATIONS.includes(op.type)) {
        throw new Error(`Operation type '${op.type}' is not whitelisted for this endpoint`);
      }
    }
  }

  /**
   * Helper to extract source account from XDR without full validation
   */
  public static getSourceAccountFromXDR(xdr: string): string {
    try {
      const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      if (tx instanceof FeeBumpTransaction) {
        return tx.innerTransaction.source;
      }
      return tx.source;
    } catch (error) {
      throw new Error('Invalid transaction XDR');
    }
  }

  /**
   * Health check for Soroban RPC connectivity
   */
  public async getHealth(): Promise<{ status: 'UP' | 'DOWN' }> {
    try {
      const sorobanRpc = this.getSorobanRpc();
      // Attempt to get the latest ledger as a connectivity check
      await sorobanRpc.getLatestLedger();
      return { status: 'UP' };
    } catch (error) {
      logger.error('Soroban RPC health check failed:', error);
      return { status: 'DOWN' };
    }
  }

  /**
   * Health check for Horizon connectivity
   */
  public async getHorizonHealth(): Promise<{ status: 'UP' | 'DOWN' }> {
    try {
      const server = this.getHorizonServer();
      // Lightweight, low-cost endpoint used purely as a connectivity check
      await server.fetchBaseFee();
      return { status: 'UP' };
    } catch (error) {
      logger.error('Horizon health check failed:', error);
      return { status: 'DOWN' };
    }
  }
}

export const stellarService = StellarService.getInstance();
