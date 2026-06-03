export type NetworkType = 'TESTNET' | 'PUBLIC' | 'STANDALONE';

export interface WalletAdapter {
  id: string;
  name: string;
  icon: string;
  isInstalled(): Promise<boolean>;
  connect(): Promise<{ publicKey: string; network: string }>;
  disconnect(): Promise<void>;
  signTransaction(xdr: string, network: string): Promise<string>;
}
