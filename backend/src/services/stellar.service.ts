import { Horizon, rpc, TransactionBuilder, Account, Networks, Memo, Operation, Keypair } from '@stellar/stellar-sdk';
import { NetworkType, NETWORKS } from '../config/networks';
import { SignerInfo, SignatureInfo } from './auth.service';
import configService from './config.service';

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
  private currentNetwork: NetworkType = NetworkType.TESTNET;

  private constructor() {}

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

  public getPassphrase(network: NetworkType = this.currentNetwork): string {
    return NETWORKS[network].passphrase;
  }

  /**
   * Fetch account signers and thresholds from Horizon
   */
  public async getAccountSigners(accountId: string): Promise<AccountSigners> {
    const server = this.getHorizonServer();
    const account = await server.loadAccount(accountId);
    
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
    const serverSecret = configService.getConfig().STELLAR_SERVER_SECRET;
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
      const serverSecret = configService.getConfig().STELLAR_SERVER_SECRET;
      const serverKeypair = Keypair.fromSecret(serverSecret);
      
      if (!transaction.signatures.some((sig: any) => 
        serverKeypair.verify(transaction.hash(), sig.signature)
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
            if (signerKeypair.verify(transaction.hash(), signature.signature)) {
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
}

export const stellarService = StellarService.getInstance();
