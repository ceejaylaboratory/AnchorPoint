import { Horizon, rpc } from '@stellar/stellar-sdk';
import { NetworkType, NETWORKS } from '../config/networks';
import { config } from '../config/env';

export class StellarService {
  private static instance: StellarService;
  private currentNetwork: NetworkType;

  private constructor() {
    // Initialize network from environment configuration
    const networkFromEnv = config.STELLAR_NETWORK.toUpperCase();
    this.currentNetwork = NetworkType[networkFromEnv as keyof typeof NetworkType] || NetworkType.TESTNET;
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
}

export const stellarService = StellarService.getInstance();
