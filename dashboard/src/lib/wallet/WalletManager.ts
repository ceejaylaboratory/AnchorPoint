import { WalletAdapter } from './types';
import { FreighterAdapter } from './FreighterAdapter';
import { AlbedoAdapter } from './AlbedoAdapter';
import { XBullAdapter } from './XBullAdapter';
import { RabetAdapter } from './RabetAdapter';
import { windowEventWatcher, withSigningGuard, type SigningGuardOptions } from './signingGuard';

export interface GuardedSignOptions extends SigningGuardOptions {
  /** Account that started signing; an account-change event for any other key aborts. */
  expectedPublicKey?: string | null;
}

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

  /**
   * Like `connectWallet`, but rejects with a `WalletSigningError` instead of
   * hanging when the wallet never answers (popup closed, extension disabled).
   */
  async connectWalletGuarded(
    id: string,
    options: SigningGuardOptions = {},
  ): Promise<{ publicKey: string; network: string }> {
    return withSigningGuard(() => this.connectWallet(id), options);
  }

  /**
   * Signs with a 90s timeout (by default), aborting early when the wallet
   * disconnects or switches accounts mid-prompt. Failures are normalised to
   * `WalletSigningError` so callers can show a reason and a retry action.
   */
  async signTransactionGuarded(
    id: string,
    xdr: string,
    network: string,
    { expectedPublicKey, watchers = [], ...options }: GuardedSignOptions = {},
  ): Promise<string> {
    return withSigningGuard(() => this.signTransaction(id, xdr, network), {
      ...options,
      watchers: [windowEventWatcher(expectedPublicKey), ...watchers],
    });
  }
}
