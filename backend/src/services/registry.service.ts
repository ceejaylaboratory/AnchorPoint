import { Address, Contract, Network, SorobanRpc, xdr } from '@stellar/stellar-sdk';
import { config } from '../config/env';
import { configService } from './config.service';
import { redisService } from './redis.service';
import { AdvancedCacheService } from './advanced-cache.service';
import { stellarService } from './stellar.service';
import logger from '../utils/logger';

export interface ContractInfo {
  address: string;
  version: string;
  contractType: string;
  deployedAt: number;
  active: boolean;
  previousVersion: string | null;
}

export class RegistryService {
  private static instance: RegistryService;
  private cacheService: AdvancedCacheService;
  private registryContractId: string;

  private constructor() {
    this.registryContractId = config.REGISTRY_CONTRACT_ID || '';
    this.cacheService = new AdvancedCacheService(redisService.client, {
      l1MaxSize: 100,
      l1TtlSeconds: 60,
      l2TtlSeconds: 300,
      staleWhileRevalidateTtlSeconds: 60,
    });
  }

  public static getInstance(): RegistryService {
    if (!RegistryService.instance) {
      RegistryService.instance = new RegistryService();
    }
    return RegistryService.instance;
  }

  private getContractClient(): Contract {
    const rpc = stellarService.getSorobanRpc();
    return new Contract(this.registryContractId);
  }

  /**
   * Get contract information by type with caching
   */
  public async getContract(contractType: string): Promise<ContractInfo> {
    const cacheKey = `registry:contract:${contractType}`;
    
    const result = await this.cacheService.cacheAside<ContractInfo>(
      cacheKey,
      async () => {
        logger.debug(`Fetching contract info from registry for type: ${contractType}`);
        const rpc = stellarService.getSorobanRpc();
        const contract = this.getContractClient();
        
        // Build the contract call
        const tx = new xdr.TransactionBuilder(
          new Address(config.ANCHOR_PUBLIC_KEY).toScAddress(),
          {
            fee: '100',
            networkPassphrase: stellarService.getPassphrase(),
          }
        )
          .addOperation(
            contract.call('get_contract', xdr.ScVal.scvString(contractType))
          )
          .setTimeout(30)
          .build();
        
        const simulatedTx = await rpc.simulateTransaction(tx);
        if (simulatedTx.error) {
          throw new Error(`Failed to simulate transaction: ${simulatedTx.error}`);
        }
        
        if (!simulatedTx.result?.retval) {
          throw new Error('No result returned from contract');
        }
        
        return this.parseContractInfo(simulatedTx.result.retval);
      },
      {
        ttlSeconds: 60,
        staleWhileRevalidate: true,
        staleTtlSeconds: 30,
      }
    );

    return result.data;
  }

  /**
   * Get contract address by type with caching
   */
  public async getAddress(contractType: string): Promise<string> {
    const info = await this.getContract(contractType);
    return info.address;
  }

  /**
   * Get contract version by type with caching
   */
  public async getVersion(contractType: string): Promise<string> {
    const info = await this.getContract(contractType);
    return info.version;
  }

  /**
   * Check if contract is registered (cached)
   */
  public async isRegistered(contractType: string): Promise<boolean> {
    try {
      await this.getContract(contractType);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if contract is active (cached)
   */
  public async isActive(contractType: string): Promise<boolean> {
    const info = await this.getContract(contractType);
    return info.active;
  }

  /**
   * Invalidate cache for a specific contract type
   */
  public async invalidateContractCache(contractType: string): Promise<void> {
    const cacheKey = `registry:contract:${contractType}`;
    await this.cacheService.invalidate(cacheKey);
    logger.debug(`Invalidated cache for contract type: ${contractType}`);
  }

  /**
   * Invalidate all registry cache
   */
  public async invalidateAllCache(): Promise<void> {
    await this.cacheService.invalidatePattern('registry:.*');
    logger.debug('Invalidated all registry cache');
  }

  private parseContractInfo(scVal: xdr.ScVal): ContractInfo {
    const map = scVal.map()!;
    const get = (key: string) => {
      const entry = map.find((e) => e.key().str() === key);
      if (!entry) throw new Error(`Missing key: ${key}`);
      return entry.val();
    };

    return {
      address: get('address').address().toString(),
      version: get('version').str().toString(),
      contractType: get('contract_type').str().toString(),
      deployedAt: Number(get('deployed_at').u64()),
      active: get('active').bool(),
      previousVersion: get('previous_version').option()
        ? get('previous_version').option()!.address().toString()
        : null,
    };
  }
}

export const registryService = RegistryService.getInstance();
