import { WalletAdapter } from './types';

type FreighterApi = {
  isConnected(): Promise<boolean>;
  getPublicKey(): Promise<string>;
  getNetwork(): Promise<string>;
  signTransaction(xdr: string, options: { network: string }): Promise<string>;
};

declare global {
  interface Window {
    freighterApi?: FreighterApi;
  }
}

export class FreighterAdapter implements WalletAdapter {
  id = 'freighter';
  name = 'Freighter';
  icon = 'freighter-icon-url';

  async isInstalled(): Promise<boolean> {
    // Check if the Freighter extension is injected
    return typeof window !== 'undefined' && !!window.freighterApi;
  }

  async connect(): Promise<{ publicKey: string; network: string }> {
    const installed = await this.isInstalled();
    if (!installed) {
      throw new Error('Freighter is not installed');
    }
    
    const api = window.freighterApi;
    if (!api) {
      throw new Error('Freighter is not installed');
    }

    try {
      if (await api.isConnected()) {
        const publicKey = await api.getPublicKey();
        const network = await api.getNetwork();
        return { publicKey, network };
      } else {
        throw new Error('User cancelled connection');
      }
    } catch (error) {
      throw new Error(`Failed to connect to Freighter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    // Freighter doesn't have a direct disconnect, but we can do local cleanup
    return Promise.resolve();
  }

  async signTransaction(xdr: string, network: string): Promise<string> {
    const installed = await this.isInstalled();
    if (!installed) {
      throw new Error('Freighter is not installed');
    }

    const api = window.freighterApi;
    if (!api) {
      throw new Error('Freighter is not installed');
    }

    try {
      const signedXdr = await api.signTransaction(xdr, { network });
      return signedXdr;
    } catch (error) {
      throw new Error(`Failed to sign transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
