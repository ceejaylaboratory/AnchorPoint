import { WalletAdapter } from './types';

type AlbedoApi = {
  isConnected(): Promise<boolean>;
  getPublicKey(): Promise<string>;
  getNetwork(): Promise<string>;
  signTransaction(xdr: string, network: string): Promise<string>;
};

declare global {
  interface Window {
    albedo?: AlbedoApi;
  }
}

export class AlbedoAdapter implements WalletAdapter {
  id = 'albedo';
  name = 'Albedo';
  icon = 'albedo-icon-url';

  async isInstalled(): Promise<boolean> {
    // Albedo is web-based, so it's always "available" via popup
    return typeof window !== 'undefined';
  }

  async connect(): Promise<{ publicKey: string; network: string }> {
    try {
      // Import dynamically to avoid SSR issues
      const albedoModule = await import('@albedo-link/intent');
      const Intent = (albedoModule as any).Intent || (albedoModule as any).default?.Intent || (albedoModule as any).default;
      
      const result = await Intent.Prompt({
        action: 'connect',
      });
      
      if (!result.pub_key) {
        throw new Error('Failed to get public key from Albedo');
      }

      return {
        publicKey: result.pub_key,
        network: result.network || 'PUBLIC',
      };
    } catch (error) {
      throw new Error(`Failed to connect to Albedo: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    // Albedo doesn't have a direct disconnect, but we can do local cleanup
    return Promise.resolve();
  }

  async signTransaction(xdr: string, network: string): Promise<string> {
    try {
      const albedoModule = await import('@albedo-link/intent');
      const Intent = (albedoModule as any).Intent || (albedoModule as any).default?.Intent || (albedoModule as any).default;
      
      const result = await Intent.Prompt({
        action: 'sign_tx',
        xdr,
        network,
      });
      
      if (!result.signed_xdr) {
        throw new Error('Failed to sign transaction with Albedo');
      }

      return result.signed_xdr;
    } catch (error) {
      throw new Error(`Failed to sign transaction with Albedo: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getNetwork(): Promise<string> {
    return 'PUBLIC';
  }
}
