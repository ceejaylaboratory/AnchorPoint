import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectWallet } from './connectWallet';

// ── Freighter ──────────────────────────────────────────────────────────────
vi.mock('@stellar/freighter-api', () => ({
  requestAccess: vi.fn(),
}));

// ── Albedo ─────────────────────────────────────────────────────────────────
vi.mock('@albedo-link/intent', () => ({
  default: {
    publicKey: vi.fn(),
  },
}));

import { requestAccess } from '@stellar/freighter-api';
import albedo from '@albedo-link/intent';

describe('connectWallet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Freighter ────────────────────────────────────────────────────────────

  it('connects Freighter and returns the public key', async () => {
    (requestAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
      address: 'GFREIGHTER123',
      error: undefined,
    });

    const pubKey = await connectWallet('freighter');
    expect(pubKey).toBe('GFREIGHTER123');
  });

  it('throws when Freighter returns an error', async () => {
    (requestAccess as ReturnType<typeof vi.fn>).mockResolvedValue({
      address: undefined,
      error: 'User rejected',
    });

    await expect(connectWallet('freighter')).rejects.toThrow('User rejected');
  });

  // ── Albedo ───────────────────────────────────────────────────────────────

  it('connects Albedo and returns the public key', async () => {
    (albedo.publicKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      pubkey: 'GALBEDO456',
    });

    const pubKey = await connectWallet('albedo');
    expect(pubKey).toBe('GALBEDO456');
  });

  it('throws when Albedo returns no pubkey', async () => {
    (albedo.publicKey as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await expect(connectWallet('albedo')).rejects.toThrow(
      'Albedo did not return a public key.',
    );
  });

  // ── xBull ────────────────────────────────────────────────────────────────

  it('connects xBull and returns the public key', async () => {
    (global as Record<string, unknown>).window = {
      xBull: {
        isConnected: vi.fn().mockResolvedValue(true),
        getPublicKey: vi.fn().mockResolvedValue('GXBULL789'),
      },
    };

    const pubKey = await connectWallet('xbull');
    expect(pubKey).toBe('GXBULL789');
  });

  it('throws when xBull extension is not present', async () => {
    (global as Record<string, unknown>).window = {};

    await expect(connectWallet('xbull')).rejects.toThrow(
      'xBull extension is not available.',
    );
  });

  it('throws when xBull reports not connected', async () => {
    (global as Record<string, unknown>).window = {
      xBull: {
        isConnected: vi.fn().mockResolvedValue(false),
        getPublicKey: vi.fn(),
      },
    };

    await expect(connectWallet('xbull')).rejects.toThrow(
      'xBull is not connected',
    );
  });

  it('throws when xBull getPublicKey returns empty', async () => {
    (global as Record<string, unknown>).window = {
      xBull: {
        isConnected: vi.fn().mockResolvedValue(true),
        getPublicKey: vi.fn().mockResolvedValue(''),
      },
    };

    await expect(connectWallet('xbull')).rejects.toThrow(
      'xBull did not return a public key.',
    );
  });

  // ── Rabet ────────────────────────────────────────────────────────────────

  it('connects Rabet and returns the public key', async () => {
    (global as Record<string, unknown>).window = {
      rabet: {
        connect: vi.fn().mockResolvedValue({ publicKey: 'GRABET999' }),
      },
    };

    const pubKey = await connectWallet('rabet');
    expect(pubKey).toBe('GRABET999');
  });

  it('throws when Rabet extension is not present', async () => {
    (global as Record<string, unknown>).window = {};

    await expect(connectWallet('rabet')).rejects.toThrow(
      'Rabet extension is not available.',
    );
  });
});
