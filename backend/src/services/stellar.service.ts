import { Horizon, rpc, TransactionBuilder, Account, Networks, Memo, Operation, Keypair, Transaction, FeeBumpTransaction, Asset, Claimant, xdr, StrKey } from '@stellar/stellar-sdk';
import { NetworkType, NETWORKS } from '../config/networks';
import { config } from '../config/env';
import { SignerInfo, SignatureInfo } from './auth.service';
import configService from './config.service';
import logger from '../utils/logger';
import prisma from '../lib/prisma';
import { traceAsync, SpanKind } from '../utils/tracing';
import { metricsService } from './metrics.service';

type FailoverProvider = 'horizon' | 'soroban-rpc';

interface NodeHealthState {
  url: string;
  consecutiveFailures: number;
  degraded: boolean;
}

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
  private horizonUrls: string[];
  private nodeHealth = new Map<string, NodeHealthState>();
  private activeHorizonIndex = 0;
  private activeRpcIndex = 0;
  private failoverProbeTimer: NodeJS.Timeout | null = null;

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
    this.horizonUrls = this.getHorizonUrls();
    this.resetNodeHealth();
  }

  private getRpcUrls(): string[] {
    const rpcUrls = config.STELLAR_RPC_URLS;
    if (rpcUrls) {
      return rpcUrls.split(',').map((url) => url.trim()).filter((url) => url.length > 0);
    }
    const networkConfig = NETWORKS[this.currentNetwork];
    return [networkConfig.sorobanRpcUrl];
  }

  private getHorizonUrls(): string[] {
    const primary = config.STELLAR_HORIZON_URL || NETWORKS[this.currentNetwork].horizonUrl;
    const fallbacks = (config.STELLAR_HORIZON_FALLBACK_URLS || '')
      .split(',')
      .map((url) => url.trim())
      .filter((url) => url.length > 0 && url !== primary);
    return [primary, ...fallbacks];
  }

  private static readonly RETRYABLE_HORIZON_STATUS_CODES = [429, 502, 503, 504];
  private static readonly TIMEOUT_ERROR_CODES = [
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'ECONNABORTED',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
  ];

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

  private nodeKey(provider: FailoverProvider, index: number): string {
    return `${provider}:${index}`;
  }

  private urlsFor(provider: FailoverProvider): string[] {
    return provider === 'horizon' ? this.horizonUrls : this.rpcUrls;
  }

  private activeIndexFor(provider: FailoverProvider): number {
    return provider === 'horizon' ? this.activeHorizonIndex : this.activeRpcIndex;
  }

  private resetNodeHealth(): void {
    this.nodeHealth.clear();
    this.activeHorizonIndex = 0;
    this.activeRpcIndex = 0;
    (['horizon', 'soroban-rpc'] as FailoverProvider[]).forEach((provider) => {
      this.urlsFor(provider).forEach((url, index) => {
        this.nodeHealth.set(this.nodeKey(provider, index), {
          url,
          consecutiveFailures: 0,
          degraded: false,
        });
        metricsService.setRpcNodeHealth(provider, index, true);
      });
    });
  }

  private orderedNodeIndices(provider: FailoverProvider): number[] {
    const urls = this.urlsFor(provider);
    const active = this.activeIndexFor(provider);
    return Array.from({ length: urls.length }, (_, offset) => (active + offset) % urls.length);
  }

  private failureReason(error: any): string {
    const status = error?.response?.status;
    if (typeof status === 'number') {
      return `http_${status}`;
    }
    if (typeof error?.code === 'string' && StellarService.TIMEOUT_ERROR_CODES.includes(error.code)) {
      return `network_${error.code.toLowerCase()}`;
    }
    return 'network_timeout';
  }

  private isFailoverError(error: any): boolean {
    const status = error?.response?.status;
    if (typeof status === 'number') {
      return StellarService.RETRYABLE_HORIZON_STATUS_CODES.includes(status) || status >= 500;
    }
    if (typeof error?.code === 'string' && StellarService.TIMEOUT_ERROR_CODES.includes(error.code)) {
      return true;
    }
    const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
    return message.includes('timeout') || message.includes('timed out');
  }

  private recordNodeFailure(provider: FailoverProvider, index: number, reason: string): void {
    const health = this.nodeHealth.get(this.nodeKey(provider, index));
    if (!health) {
      return;
    }
    health.consecutiveFailures += 1;
    if (health.degraded || health.consecutiveFailures < config.STELLAR_FAILOVER_FAILURE_THRESHOLD) {
      return;
    }

    health.degraded = true;
    metricsService.setRpcNodeHealth(provider, index, false);

    const urls = this.urlsFor(provider);
    const nextIndex = this.orderedNodeIndices(provider).find((candidate) => {
      if (candidate === index) {
        return false;
      }
      return !this.nodeHealth.get(this.nodeKey(provider, candidate))?.degraded;
    });
    if (nextIndex === undefined) {
      logger.warn(`${provider} endpoint at index ${index} degraded but no healthy standby is available`, {
        reason,
      });
      return;
    }

    if (provider === 'horizon') {
      this.activeHorizonIndex = nextIndex;
    } else {
      this.activeRpcIndex = nextIndex;
    }
    metricsService.incrementRpcNodeFailover(provider, index, nextIndex, reason);
    logger.warn(`${provider} endpoint degraded; routing traffic to standby`, {
      from_index: index,
      to_index: nextIndex,
      from_url: urls[index],
      to_url: urls[nextIndex],
      reason,
    });
  }

  private recordNodeSuccess(provider: FailoverProvider, index: number): void {
    const health = this.nodeHealth.get(this.nodeKey(provider, index));
    if (health) {
      health.consecutiveFailures = 0;
    }
  }

  private recoverNode(provider: FailoverProvider, index: number): void {
    const health = this.nodeHealth.get(this.nodeKey(provider, index));
    if (!health || !health.degraded) {
      return;
    }
    health.degraded = false;
    health.consecutiveFailures = 0;
    metricsService.setRpcNodeHealth(provider, index, true);
    metricsService.incrementRpcNodeRecovery(provider, index);
    if (index === 0) {
      if (provider === 'horizon') {
        this.activeHorizonIndex = 0;
      } else {
        this.activeRpcIndex = 0;
      }
    }
    logger.info(`${provider} primary endpoint recovered; restoring primary routing`, { index });
  }

  /**
   * Runs a Horizon request against the active endpoint and fails over to a
   * configured standby when the active endpoint is degraded.
   */
  private async withHorizonFailover<T>(
    fn: (server: Horizon.Server) => Promise<T>,
    maxRetries?: number
  ): Promise<T> {
    const urls = this.horizonUrls;
    const retries = maxRetries ?? (urls.length > 1 ? 0 : 3);
    let lastError: unknown;

    for (const index of this.orderedNodeIndices('horizon')) {
      const server = new Horizon.Server(urls[index]);
      try {
        const result = await this.retryHorizonRequest(() => fn(server), retries);
        this.recordNodeSuccess('horizon', index);
        return result;
      } catch (error: any) {
        if (!this.isFailoverError(error)) {
          throw error;
        }
        lastError = error;
        this.recordNodeFailure('horizon', index, this.failureReason(error));
      }
    }
    throw lastError;
  }

  /**
   * Probes degraded endpoints and restores primary routing once healthy.
   */
  public async probeDegradedNodes(): Promise<number> {
    let recovered = 0;
    for (const provider of ['horizon', 'soroban-rpc'] as FailoverProvider[]) {
      const urls = this.urlsFor(provider);
      for (let index = 0; index < urls.length; index++) {
        if (!this.nodeHealth.get(this.nodeKey(provider, index))?.degraded) {
          continue;
        }
        try {
          if (provider === 'horizon') {
            await new Horizon.Server(urls[index]).fetchBaseFee();
          } else {
            const server = new rpc.Server(urls[index]);
            await this.traceRpcCall('getLatestLedger', [], () => server.getLatestLedger());
          }
          this.recoverNode(provider, index);
          recovered += 1;
        } catch (error) {
          logger.debug(`${provider} recovery probe failed for endpoint at index ${index}`, { error });
        }
      }
    }
    return recovered;
  }

  public startFailoverMonitor(): void {
    if (this.failoverProbeTimer) {
      return;
    }
    if (this.horizonUrls.length <= 1 && this.rpcUrls.length <= 1) {
      return;
    }
    const intervalMs = config.STELLAR_FAILOVER_PROBE_INTERVAL_MS;
    this.failoverProbeTimer = setInterval(() => {
      void this.probeDegradedNodes().catch((error) => {
        logger.warn('Failover recovery probe failed', { error });
      });
    }, intervalMs);
    this.failoverProbeTimer.unref();
    logger.info('Stellar failover recovery monitor started', { interval_ms: intervalMs });
  }

  public stopFailoverMonitor(): void {
    if (!this.failoverProbeTimer) {
      return;
    }
    clearInterval(this.failoverProbeTimer);
    this.failoverProbeTimer = null;
    logger.info('Stellar failover recovery monitor stopped');
  }

  /**
   * Wraps a Soroban RPC call in a child span with `rpc.method`, `contract.id`
   * and `ledger.sequence` attributes. Errors mark the span as ERROR.
   */
  private traceRpcCall<T>(method: string, args: any[], fn: () => Promise<T>): Promise<T> {
    return traceAsync(
      `soroban.rpc.${method}`,
      async (span) => {
        span.setAttribute('rpc.method', method);
        const target = args[0];
        const contractId = typeof target?.contractId === 'function' ? target.contractId() : target;
        if (typeof contractId === 'string' && StrKey.isValidContract(contractId)) {
          span.setAttribute('contract.id', contractId);
        }
        const result: any = await fn();
        const ledgerSequence = result?.sequence ?? result?.latestLedger;
        if (typeof ledgerSequence === 'number') {
          span.setAttribute('ledger.sequence', ledgerSequence);
        }
        return result;
      },
      SpanKind.CLIENT
    );
  }

  private async executeRpcWithFailover<T>(method: string, ...args: any[]): Promise<T> {
    return this.traceRpcCall(method, args, () => this.executeRpcWithFailoverUntraced<T>(method, ...args));
  }

  private async executeRpcWithFailoverUntraced<T>(method: string, ...args: any[]): Promise<T> {
    let lastError: unknown;
    for (const index of this.orderedNodeIndices('soroban-rpc')) {
      const rpcServer = new rpc.Server(this.rpcUrls[index]);
      try {
        const rpcMethod = (rpcServer as any)[method];
        if (typeof rpcMethod !== 'function') {
          throw new Error(`RPC method '${method}' not found on rpc.Server`);
        }
        const result = await rpcMethod.apply(rpcServer, args);
        this.recordNodeSuccess('soroban-rpc', index);
        return result;
      } catch (error: any) {
        if (!this.isFailoverError(error)) {
          throw error;
        }
        lastError = error;
        this.recordNodeFailure('soroban-rpc', index, this.failureReason(error));
      }
    }
    throw lastError || new Error('All RPC servers failed');
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
    this.horizonUrls = this.getHorizonUrls();
    this.resetNodeHealth();
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
    const primaryServer = new rpc.Server(this.rpcUrls[0]);
    return new Proxy(primaryServer, {
      get: (target: rpc.Server, prop: string, receiver: any) => {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function' && prop !== 'constructor') {
          return (...args: any[]) => this.traceRpcCall(prop, args, async () => {
            let lastError: unknown;
            for (const index of this.orderedNodeIndices('soroban-rpc')) {
              const server = new rpc.Server(this.rpcUrls[index]);
              try {
                const method = Reflect.get(server, prop, receiver);
                if (typeof method !== 'function') {
                  throw new Error(`RPC method '${prop}' not found on rpc.Server`);
                }
                const result = await method.apply(server, args);
                this.recordNodeSuccess('soroban-rpc', index);
                return result;
              } catch (error: any) {
                if (!this.isFailoverError(error)) {
                  throw error;
                }
                lastError = error;
                this.recordNodeFailure('soroban-rpc', index, this.failureReason(error));
              }
            }
            throw lastError || new Error('All RPC servers failed');
          });
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
    const account = await this.withHorizonFailover((server) => server.loadAccount(accountId));

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
    const account = await this.withHorizonFailover((server) => server.loadAccount(accountPublicKey));

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
    const networkPassphrase = this.getPassphrase();

    const senderAccount = await this.withHorizonFailover((server) =>
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

    const response = await this.withHorizonFailover((activeServer) => activeServer.submitTransaction(tx));

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

      const response = await this.withHorizonFailover((server) => server.submitTransaction(finalTx));
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
      await this.traceRpcCall('getLatestLedger', [], () => sorobanRpc.getLatestLedger());
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
