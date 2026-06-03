import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FreighterAdapter } from './FreighterAdapter';

describe('FreighterAdapter', () => {
  let adapter: FreighterAdapter;

  beforeEach(() => {
    adapter = new FreighterAdapter();
    // Clear global window property before each test
    Reflect.deleteProperty(globalThis, 'window');
    globalThis.window = {} as any;
  });

  describe('isInstalled', () => {
    it('returns false when window.freighterApi is undefined', async () => {
      const installed = await adapter.isInstalled();
      expect(installed).toBe(false);
    });

    it('returns true when window.freighterApi is defined', async () => {
      (globalThis.window as any).freighterApi = {};
      const installed = await adapter.isInstalled();
      expect(installed).toBe(true);
    });
  });

  describe('connect', () => {
    it('throws error if not installed', async () => {
      await expect(adapter.connect()).rejects.toThrow('Freighter is not installed');
    });

    it('throws error if connection cancelled', async () => {
      (globalThis.window as any).freighterApi = {
        isConnected: vi.fn().mockResolvedValue(false),
      };
      await expect(adapter.connect()).rejects.toThrow('User cancelled connection');
    });

    it('returns publicKey and network on successful connection', async () => {
      (globalThis.window as any).freighterApi = {
        isConnected: vi.fn().mockResolvedValue(true),
        getPublicKey: vi.fn().mockResolvedValue('GB...TEST'),
        getNetwork: vi.fn().mockResolvedValue('TESTNET'),
      };
      const result = await adapter.connect();
      expect(result).toEqual({ publicKey: 'GB...TEST', network: 'TESTNET' });
    });
    
    it('wraps and throws api errors', async () => {
      (globalThis.window as any).freighterApi = {
        isConnected: vi.fn().mockRejectedValue(new Error('Extension error')),
      };
      await expect(adapter.connect()).rejects.toThrow('Failed to connect to Freighter: Extension error');
    });
  });

  describe('signTransaction', () => {
    it('throws error if not installed', async () => {
      await expect(adapter.signTransaction('some_xdr', 'TESTNET')).rejects.toThrow('Freighter is not installed');
    });

    it('returns signed xdr successfully', async () => {
      (globalThis.window as any).freighterApi = {
        signTransaction: vi.fn().mockResolvedValue('signed_xdr_data'),
      };
      const result = await adapter.signTransaction('some_xdr', 'TESTNET');
      expect(result).toBe('signed_xdr_data');
      expect((globalThis.window as any).freighterApi.signTransaction).toHaveBeenCalledWith('some_xdr', { network: 'TESTNET' });
    });
  });

  describe('disconnect', () => {
    it('resolves void', async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });
});
