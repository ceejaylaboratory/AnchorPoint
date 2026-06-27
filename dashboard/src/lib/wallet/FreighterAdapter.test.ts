import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FreighterAdapter } from './FreighterAdapter';

type TestFreighterApi = NonNullable<Window['freighterApi']>;

const setFreighterApi = (api: Partial<TestFreighterApi>) => {
  globalThis.window.freighterApi = api as TestFreighterApi;
};

describe('FreighterAdapter', () => {
  let adapter: FreighterAdapter;

  beforeEach(() => {
    adapter = new FreighterAdapter();
    // Clear global window property before each test
    Reflect.deleteProperty(globalThis, 'window');
    globalThis.window = {} as Window & typeof globalThis;
  });

  describe('isInstalled', () => {
    it('returns false when window.freighterApi is undefined', async () => {
      const installed = await adapter.isInstalled();
      expect(installed).toBe(false);
    });

    it('returns true when window.freighterApi is defined', async () => {
      setFreighterApi({});
      const installed = await adapter.isInstalled();
      expect(installed).toBe(true);
    });
  });

  describe('connect', () => {
    it('throws error if not installed', async () => {
      await expect(adapter.connect()).rejects.toThrow('Freighter is not installed');
    });

    it('throws error if connection cancelled', async () => {
      setFreighterApi({
        isConnected: vi.fn().mockResolvedValue(false),
      });
      await expect(adapter.connect()).rejects.toThrow('User cancelled connection');
    });

    it('returns publicKey and network on successful connection', async () => {
      setFreighterApi({
        isConnected: vi.fn().mockResolvedValue(true),
        getPublicKey: vi.fn().mockResolvedValue('GB...TEST'),
        getNetwork: vi.fn().mockResolvedValue('TESTNET'),
      });
      const result = await adapter.connect();
      expect(result).toEqual({ publicKey: 'GB...TEST', network: 'TESTNET' });
    });
    
    it('wraps and throws api errors', async () => {
      setFreighterApi({
        isConnected: vi.fn().mockRejectedValue(new Error('Extension error')),
      });
      await expect(adapter.connect()).rejects.toThrow('Failed to connect to Freighter: Extension error');
    });
  });

  describe('signTransaction', () => {
    it('throws error if not installed', async () => {
      await expect(adapter.signTransaction('some_xdr', 'TESTNET')).rejects.toThrow('Freighter is not installed');
    });

    it('returns signed xdr successfully', async () => {
      const signTransaction = vi.fn().mockResolvedValue('signed_xdr_data');
      setFreighterApi({
        signTransaction,
      });
      const result = await adapter.signTransaction('some_xdr', 'TESTNET');
      expect(result).toBe('signed_xdr_data');
      expect(signTransaction).toHaveBeenCalledWith('some_xdr', { network: 'TESTNET' });
    });
  });

  describe('disconnect', () => {
    it('resolves void', async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });
});
