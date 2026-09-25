import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AlbedoAdapter } from './AlbedoAdapter';

// Mock @albedo-link/intent
vi.mock('@albedo-link/intent', () => ({
  Intent: {
    Prompt: vi.fn(),
  },
  default: {
    Intent: {
      Prompt: vi.fn(),
    },
  },
}));

describe('AlbedoAdapter', () => {
  let adapter: AlbedoAdapter;

  beforeEach(() => {
    adapter = new AlbedoAdapter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct id and name', () => {
    expect(adapter.id).toBe('albedo');
    expect(adapter.name).toBe('Albedo');
  });

  it('isInstalled returns true (Albedo is web-based)', async () => {
    const installed = await adapter.isInstalled();
    expect(installed).toBe(true);
  });

  it('connects successfully with Albedo', async () => {
    const albedoModule: any = await import('@albedo-link/intent');
    const Intent = albedoModule.Intent || albedoModule.default?.Intent;
    Intent.Prompt.mockResolvedValue({
      pub_key: 'GABCD1234567890',
      network: 'PUBLIC',
    });

    const result = await adapter.connect();
    expect(result.publicKey).toBe('GABCD1234567890');
    expect(result.network).toBe('PUBLIC');
  });

  it('handles connection errors', async () => {
    const albedoModule: any = await import('@albedo-link/intent');
    const Intent = albedoModule.Intent || albedoModule.default?.Intent;
    Intent.Prompt.mockRejectedValue(new Error('User cancelled'));

    await expect(adapter.connect()).rejects.toThrow('Failed to connect to Albedo');
  });

  it('signs transaction successfully', async () => {
    const albedoModule: any = await import('@albedo-link/intent');
    const Intent = albedoModule.Intent || albedoModule.default?.Intent;
    Intent.Prompt.mockResolvedValue({
      signed_xdr: 'SIGNED_XDR_HERE',
    });

    const result = await adapter.signTransaction('TEST_XDR', 'PUBLIC');
    expect(result).toBe('SIGNED_XDR_HERE');
  });

  it('handles signing errors', async () => {
    const albedoModule: any = await import('@albedo-link/intent');
    const Intent = albedoModule.Intent || albedoModule.default?.Intent;
    Intent.Prompt.mockRejectedValue(new Error('Signing failed'));

    await expect(adapter.signTransaction('TEST_XDR', 'PUBLIC')).rejects.toThrow('Failed to sign transaction');
  });

  it('disconnects successfully', async () => {
    await expect(adapter.disconnect()).resolves.not.toThrow();
  });
});
