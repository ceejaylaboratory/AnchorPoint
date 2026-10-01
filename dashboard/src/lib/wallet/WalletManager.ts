import { WalletAdapter } from './types';
import { FreighterAdapter } from './FreighterAdapter';
import { AlbedoAdapter } from './AlbedoAdapter';
import { XBullAdapter } from './XBullAdapter';
import { RabetAdapter } from './RabetAdapter';

export interface WalletOption {
  id: string;
  name: string;
  description: string;
  accent: string;
  installed: boolean;
}

export class WalletManager {
  private adapters: Map<string, WalletAdapter> = new Map();
  private static instance: WalletManager;

  private constructor() {
    this.initializeAdapters();
  }

  static getInstance(): WalletManager {
    if (!WalletManager.instance) {
      WalletManager.instance = new WalletManager();
    }
    return WalletManager.instance;
  }

  private initializeAdapters() {
    this.adapters.set('freighter', new FreighterAdapter());
    this.adapters.set('albedo', new AlbedoAdapter());
    this.adapters.set('xbull', new XBullAdapter());
    this.adapters.set('rabet', new RabetAdapter());
  }

  getAdapter(id: string): WalletAdapter | undefined {
    return this.adapters.get(id);
  }

  async getWalletOptions(): Promise<WalletOption[]> {
    const options: WalletOption[] = [
      {
        id: 'freighter',
        name: 'Freighter',
        description: 'Connect your Stellar account with the Freighter browser extension.',
        accent: 'from-sky-500/20 to-cyan-500/20',
        installed: false,
      },
      {
        id: 'albedo',
        name: 'Albedo',
        description: 'Use the Albedo wallet for a quick sign-in flow.',
        accent: 'from-fuchsia-500/20 to-violet-500/20',
        installed: false,
      },
      {
        id: 'xbull',
        name: 'xBull',
        description: 'Connect with the xBull wallet extension.',
        accent: 'from-orange-500/20 to-amber-500/20',
        installed: false,
      },
      {
        id: 'rabet',
        name: 'Rabet',
        description: 'Use the Rabet wallet for Stellar transactions.',
        accent: 'from-emerald-500/20 to-lime-500/20',
        installed: false,
      },
    ];

    // Check installation status for all wallets
    await Promise.all(
      options.map(async (option) => {
        const adapter = this.adapters.get(option.id);
        if (adapter && typeof adapter.isInstalled === 'function') {
          option.installed = await adapter.isInstalled();
        } else if (adapter) {
          option.installed = true;
        }
      })
    );

    return options;
  }

  async connectWallet(id: string): Promise<{ publicKey: string; network: string }> {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Wallet adapter not found for id: ${id}`);
    }

    return adapter.connect();
  }

  async disconnectWallet(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Wallet adapter not found for id: ${id}`);
    }

    return adapter.disconnect();
  }

  async signTransaction(id: string, xdr: string, network: string): Promise<string> {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Wallet adapter not found for id: ${id}`);
    }

    return adapter.signTransaction(xdr, network);
  }
}
