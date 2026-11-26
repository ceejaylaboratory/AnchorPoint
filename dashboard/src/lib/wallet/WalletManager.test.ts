import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { WalletManager } from './WalletManager';
import { FreighterAdapter } from './FreighterAdapter';
import { AlbedoAdapter } from './AlbedoAdapter';
import { XBullAdapter } from './XBullAdapter';
import { RabetAdapter } from './RabetAdapter';

describe('WalletManager', () => {
  let walletManager: WalletManager;

  beforeEach(() => {
    walletManager = WalletManager.getInstance();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns singleton instance', () => {
    const instance1 = WalletManager.getInstance();
    const instance2 = WalletManager.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('has all wallet adapters initialized', () => {
    expect(walletManager.getAdapter('freighter')).toBeInstanceOf(FreighterAdapter);
    expect(walletManager.getAdapter('albedo')).toBeInstanceOf(AlbedoAdapter);
    expect(walletManager.getAdapter('xbull')).toBeInstanceOf(XBullAdapter);
    expect(walletManager.getAdapter('rabet')).toBeInstanceOf(RabetAdapter);
  });

  it('returns undefined for unknown wallet', () => {
    expect(walletManager.getAdapter('unknown')).toBeUndefined();
  });

  it('returns wallet options with installation status', async () => {
    // Mock the adapter methods
    vi.spyOn(walletManager.getAdapter('freighter')!, 'isInstalled').mockResolvedValue(true);
    vi.spyOn(walletManager.getAdapter('albedo')!, 'isInstalled').mockResolvedValue(true);
    vi.spyOn(walletManager.getAdapter('xbull')!, 'isInstalled').mockResolvedValue(false);
    vi.spyOn(walletManager.getAdapter('rabet')!, 'isInstalled').mockResolvedValue(false);

    const options = await walletManager.getWalletOptions();

    expect(options).toHaveLength(4);
    expect(options[0].id).toBe('freighter');
    expect(options[1].id).toBe('albedo');
    expect(options[2].id).toBe('xbull');
    expect(options[3].id).toBe('rabet');
    expect(options[0].installed).toBe(true);
    expect(options[1].installed).toBe(true);
    expect(options[2].installed).toBe(false);
    expect(options[3].installed).toBe(false);
  });

  it('connects to wallet successfully', async () => {
    const mockAdapter = walletManager.getAdapter('freighter')!;
    vi.spyOn(mockAdapter, 'connect').mockResolvedValue({
      publicKey: 'GABCD1234567890',
      network: 'PUBLIC',
    });

    const result = await walletManager.connectWallet('freighter');
    expect(result.publicKey).toBe('GABCD1234567890');
    expect(result.network).toBe('PUBLIC');
  });

  it('throws error when connecting to unknown wallet', async () => {
    await expect(walletManager.connectWallet('unknown')).rejects.toThrow('Wallet adapter not found');
  });

  it('disconnects from wallet successfully', async () => {
    const mockAdapter = walletManager.getAdapter('freighter')!;
    vi.spyOn(mockAdapter, 'disconnect').mockResolvedValue(undefined);

    await expect(walletManager.disconnectWallet('freighter')).resolves.not.toThrow();
  });

  it('signs transaction successfully', async () => {
    const mockAdapter = walletManager.getAdapter('freighter')!;
    vi.spyOn(mockAdapter, 'signTransaction').mockResolvedValue('SIGNED_XDR');

    const result = await walletManager.signTransaction('freighter', 'TEST_XDR', 'PUBLIC');
    expect(result).toBe('SIGNED_XDR');
  });

  describe('guarded signing (#1617)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects with a timeout instead of hanging when the wallet never answers', async () => {
      vi.useFakeTimers();
      vi.spyOn(walletManager.getAdapter('freighter')!, 'signTransaction').mockImplementation(
        () => new Promise<string>(() => {}),
      );

      const promise = walletManager.signTransactionGuarded('freighter', 'TEST_XDR', 'PUBLIC');
      const assertion = expect(promise).rejects.toMatchObject({ name: 'WalletSigningError', code: 'timeout' });
      await vi.advanceTimersByTimeAsync(90_000);
      await assertion;
    });

    it('aborts when the extension disconnects mid-prompt', async () => {
      vi.spyOn(walletManager.getAdapter('freighter')!, 'signTransaction').mockImplementation(
        () => new Promise<string>(() => {}),
      );

      const promise = walletManager.signTransactionGuarded('freighter', 'TEST_XDR', 'PUBLIC');
      window.dispatchEvent(new Event('freighter:disconnect'));

      await expect(promise).rejects.toMatchObject({ code: 'disconnected' });
    });

    it('aborts when a different account becomes active', async () => {
      vi.spyOn(walletManager.getAdapter('freighter')!, 'signTransaction').mockImplementation(
        () => new Promise<string>(() => {}),
      );

      const promise = walletManager.signTransactionGuarded('freighter', 'TEST_XDR', 'PUBLIC', {
        expectedPublicKey: 'GA_ORIGINAL',
      });
      window.dispatchEvent(new CustomEvent('freighter:accountChanged', { detail: { publicKey: 'GB_OTHER' } }));

      await expect(promise).rejects.toMatchObject({ code: 'account_changed' });
    });

    it('maps a user rejection in the wallet to "cancelled"', async () => {
      vi.spyOn(walletManager.getAdapter('freighter')!, 'signTransaction').mockRejectedValue(
        new Error('Failed to sign transaction: User declined access'),
      );

      await expect(
        walletManager.signTransactionGuarded('freighter', 'TEST_XDR', 'PUBLIC'),
      ).rejects.toMatchObject({ code: 'cancelled' });
    });

    it('resolves with the signed XDR on success', async () => {
      vi.spyOn(walletManager.getAdapter('freighter')!, 'signTransaction').mockResolvedValue('SIGNED_XDR');
      await expect(
        walletManager.signTransactionGuarded('freighter', 'TEST_XDR', 'PUBLIC'),
      ).resolves.toBe('SIGNED_XDR');
    });
  });
});
