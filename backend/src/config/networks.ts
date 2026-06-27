import { Networks } from '@stellar/stellar-sdk';

export enum NetworkType {
  PUBLIC = 'PUBLIC',
  TESTNET = 'TESTNET',
  FUTURENET = 'FUTURENET',
}

export interface NetworkConfig {
  horizonUrl: string;
  sorobanRpcUrl: string;
  passphrase: string;
}

export const NETWORKS: Record<NetworkType, NetworkConfig> = {
  [NetworkType.PUBLIC]: {
    horizonUrl: 'https://horizon.stellar.org',
    sorobanRpcUrl: 'https://mainnet.stellar.org:443',
    passphrase: Networks.PUBLIC,
  },
  [NetworkType.TESTNET]: {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    passphrase: Networks.TESTNET,
  },
  [NetworkType.FUTURENET]: {
    horizonUrl: 'https://horizon-futurenet.stellar.org',
    sorobanRpcUrl: 'https://rpc-futurenet.stellar.org',
    passphrase: Networks.FUTURENET,
  },
};
