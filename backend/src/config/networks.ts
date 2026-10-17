export const StellarNetworks = {
  PUBLIC: 'Public Global Stellar Network ; September 2015',
  TESTNET: 'Test SDF Network ; September 2015',
  FUTURENET: 'Test SDF Future Network ; October 2022',
};

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
    passphrase: StellarNetworks.PUBLIC,
  },
  [NetworkType.TESTNET]: {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    passphrase: StellarNetworks.TESTNET,
  },
  [NetworkType.FUTURENET]: {
    horizonUrl: 'https://horizon-futurenet.stellar.org',
    sorobanRpcUrl: 'https://rpc-futurenet.stellar.org',
    passphrase: StellarNetworks.FUTURENET,
  },
};
